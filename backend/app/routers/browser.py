"""
Browser Router - API endpoints for browser session management and live viewing.

Endpoints:
- POST /browser/sessions - Create a new browser session
- GET /browser/sessions - List active browser sessions
- GET /browser/sessions/{session_id} - Get session details
- DELETE /browser/sessions/{session_id} - Stop a browser session
- WebSocket /browser/sessions/{session_id}/cdp - CDP proxy
- WebSocket /browser/sessions/{session_id}/vnc - VNC WebSocket proxy
- GET /browser/sessions/{session_id}/view - noVNC viewer HTML
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
import httpx
import websockets

from app.services.browser_orchestrator import (
    BrowserOrchestrator,
    BrowserSession,
    BrowserPhase,
    BrowserSessionStatus,
    get_orchestrator,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/browser", tags=["browser"])


# ============================================
# Request/Response Schemas
# ============================================

class CreateBrowserSessionRequest(BaseModel):
    """Request to create a new browser session."""
    phase: str = Field(..., description="Phase: 'analysis' or 'execution'")
    test_session_id: str | None = Field(None, description="Test session ID for analysis")
    test_run_id: str | None = Field(None, description="Test run ID for execution")


class BrowserSessionResponse(BaseModel):
    """Response for a browser session."""
    id: str
    phase: str
    status: str
    cdp_url: str | None = None
    novnc_url: str | None = None
    live_view_url: str | None = None
    created_at: str
    expires_at: str | None = None
    test_session_id: str | None = None
    test_run_id: str | None = None
    error_message: str | None = None

    @classmethod
    def from_session(cls, session: BrowserSession, request: Request | None = None) -> "BrowserSessionResponse":
        """Create response from BrowserSession."""
        # Build live view URL based on request
        live_view_url = None
        novnc_url = None

        if request and session.is_active:
            # Determine the correct scheme based on X-Forwarded-Proto header
            # (set by nginx/reverse proxy when SSL is terminated at the proxy)
            forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
            host = request.headers.get("host", request.url.netloc)
            base_url = f"{forwarded_proto}://{host}"
            live_view_url = f"{base_url}/browser/sessions/{session.id}/view"

            # Use the live_view_url as novnc_url - it handles SSL properly via WebSocket proxy
            if session.novnc_port:
                novnc_url = live_view_url

        return cls(
            id=session.id,
            phase=session.phase.value,
            status=session.status.value,
            cdp_url=session.cdp_url,
            novnc_url=novnc_url or session.novnc_url,
            live_view_url=live_view_url,
            created_at=session.created_at.isoformat(),
            expires_at=session.expires_at.isoformat() if session.expires_at else None,
            test_session_id=session.test_session_id,
            test_run_id=session.test_run_id,
            error_message=session.error_message,
        )


# ============================================
# REST Endpoints
# ============================================

@router.post("/sessions", response_model=BrowserSessionResponse)
async def create_browser_session(
    request_body: CreateBrowserSessionRequest,
    request: Request,
):
    """Create a new isolated browser session."""
    try:
        phase = BrowserPhase(request_body.phase.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid phase: {request_body.phase}. Must be 'analysis' or 'execution'"
        )
    
    orchestrator = get_orchestrator()
    
    try:
        session = await orchestrator.create_session(
            phase=phase,
            test_session_id=request_body.test_session_id,
            test_run_id=request_body.test_run_id,
        )
        return BrowserSessionResponse.from_session(session, request)
    except Exception as e:
        logger.error(f"Failed to create browser session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions", response_model=list[BrowserSessionResponse])
async def list_browser_sessions(
    request: Request,
    phase: str | None = None,
    active_only: bool = True,
):
    """List browser sessions."""
    orchestrator = get_orchestrator()
    
    browser_phase = None
    if phase:
        try:
            browser_phase = BrowserPhase(phase.lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid phase: {phase}. Must be 'analysis' or 'execution'"
            )
    
    sessions = await orchestrator.list_sessions(phase=browser_phase, active_only=active_only)
    return [BrowserSessionResponse.from_session(s, request) for s in sessions]


@router.get("/sessions/{session_id}", response_model=BrowserSessionResponse)
async def get_browser_session(session_id: str, request: Request):
    """Get browser session details."""
    orchestrator = get_orchestrator()
    session = await orchestrator.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")
    
    return BrowserSessionResponse.from_session(session, request)


@router.delete("/sessions/{session_id}")
async def stop_browser_session(session_id: str):
    """Stop and remove a browser session."""
    orchestrator = get_orchestrator()
    success = await orchestrator.stop_session(session_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Browser session not found")
    
    return {"status": "stopped", "session_id": session_id}


@router.post("/sessions/{session_id}/touch")
async def touch_browser_session(session_id: str):
    """Mark a browser session as active (reset inactivity timer)."""
    orchestrator = get_orchestrator()
    success = await orchestrator.touch_session(session_id)

    if not success:
        raise HTTPException(status_code=404, detail="Browser session not found")

    return {"status": "touched", "session_id": session_id}


class NavigateRequest(BaseModel):
    url: str


@router.post("/sessions/{session_id}/navigate")
async def navigate_browser(session_id: str, request: NavigateRequest):
    """Navigate the browser to a specific URL.

    Useful for resetting the browser to about:blank or navigating to a start page.
    """
    from playwright.async_api import async_playwright

    orchestrator = get_orchestrator()
    session = await orchestrator.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")

    if not session.cdp_url:
        raise HTTPException(status_code=400, detail="Browser session has no CDP URL")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(session.cdp_url)
            contexts = browser.contexts
            if contexts:
                pages = contexts[0].pages
                if pages:
                    await pages[0].goto(request.url, wait_until="domcontentloaded", timeout=10000)
                    return {"status": "navigated", "session_id": session_id, "url": request.url}

            raise HTTPException(status_code=400, detail="No active page found in browser")
    except Exception as e:
        logger.error(f"Error navigating browser {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to navigate browser: {str(e)}")


@router.post("/sessions/stop-all")
async def stop_all_browser_sessions():
    """Stop all browser sessions and clean up containers.
    
    Use this as a reset button to kill all browsers.
    """
    orchestrator = get_orchestrator()
    stopped_count = await orchestrator.stop_all_sessions()
    
    return {
        "status": "stopped_all",
        "stopped_count": stopped_count,
    }


# ============================================
# CDP WebSocket Proxy
# ============================================

@router.websocket("/sessions/{session_id}/cdp")
async def cdp_websocket_proxy(websocket: WebSocket, session_id: str):
    """
    Proxy WebSocket connection to browser's CDP endpoint.
    
    Used by browser-use and Playwright to control the browser.
    """
    await websocket.accept()
    
    orchestrator = get_orchestrator()
    session = await orchestrator.get_session(session_id)
    
    if not session or not session.is_active:
        await websocket.close(code=4004, reason="Session not found or not active")
        return
    
    if not session.cdp_url:
        await websocket.close(code=4004, reason="CDP not available")
        return
    
    # Update session status
    session.status = BrowserSessionStatus.CONNECTED
    
    logger.info(f"CDP proxy connecting to {session.cdp_url}")
    
    try:
        async with websockets.connect(session.cdp_url) as cdp_ws:
            async def client_to_cdp():
                """Forward messages from client to CDP."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        await cdp_ws.send(data)
                except WebSocketDisconnect:
                    logger.debug("Client disconnected from CDP proxy")
                except Exception as e:
                    logger.error(f"Error forwarding to CDP: {e}")

            async def cdp_to_client():
                """Forward messages from CDP to client."""
                try:
                    async for message in cdp_ws:
                        if isinstance(message, str):
                            await websocket.send_text(message)
                        else:
                            await websocket.send_bytes(message)
                except Exception as e:
                    logger.error(f"Error forwarding from CDP: {e}")

            # Run both directions concurrently
            await asyncio.gather(
                client_to_cdp(),
                cdp_to_client(),
                return_exceptions=True
            )
            
    except websockets.exceptions.ConnectionClosed:
        logger.debug("CDP connection closed")
    except Exception as e:
        logger.error(f"CDP proxy error: {e}")
    finally:
        session.status = BrowserSessionStatus.READY
        try:
            await websocket.close()
        except Exception:
            pass


# ============================================
# VNC WebSocket Proxy (for noVNC)
# ============================================

@router.websocket("/sessions/{session_id}/vnc")
async def vnc_websocket_proxy(websocket: WebSocket, session_id: str):
    """
    Proxy WebSocket connection to browser's VNC/websockify endpoint.
    
    Used by noVNC client for live browser viewing.
    """
    await websocket.accept()
    
    orchestrator = get_orchestrator()
    session = await orchestrator.get_session(session_id)
    
    if not session or not session.is_active:
        await websocket.close(code=4004, reason="Session not found or not active")
        return
    
    if not session.novnc_port:
        await websocket.close(code=4004, reason="VNC not available")
        return

    # Determine the correct port for VNC connection
    # When connecting to container IP (Docker-to-Docker), use internal port 7900
    # When connecting to localhost, use the mapped host port
    INTERNAL_NOVNC_PORT = 7900
    vnc_port = INTERNAL_NOVNC_PORT if session.novnc_host != "127.0.0.1" else session.novnc_port

    # noVNC uses websockify on the same port as HTTP
    vnc_ws_url = f"ws://{session.novnc_host}:{vnc_port}/websockify"

    logger.info(f"VNC proxy connecting to {vnc_ws_url}")
    
    try:
        async with websockets.connect(vnc_ws_url, subprotocols=["binary"]) as vnc_ws:
            async def client_to_vnc():
                """Forward messages from client to VNC."""
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        await vnc_ws.send(data)
                except WebSocketDisconnect:
                    logger.debug("Client disconnected from VNC proxy")
                except Exception as e:
                    logger.error(f"Error forwarding to VNC: {e}")

            async def vnc_to_client():
                """Forward messages from VNC to client."""
                try:
                    async for message in vnc_ws:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except Exception as e:
                    logger.error(f"Error forwarding from VNC: {e}")

            await asyncio.gather(
                client_to_vnc(),
                vnc_to_client(),
                return_exceptions=True
            )
            
    except websockets.exceptions.ConnectionClosed:
        logger.debug("VNC connection closed")
    except Exception as e:
        logger.error(f"VNC proxy error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ============================================
# noVNC HTTP Proxy (for static assets)
# ============================================

@router.get("/sessions/{session_id}/novnc/{path:path}")
async def novnc_http_proxy(session_id: str, path: str):
    """Proxy HTTP requests to noVNC static files."""
    orchestrator = get_orchestrator()
    session = await orchestrator.get_session(session_id)
    
    if not session or not session.is_active:
        raise HTTPException(status_code=404, detail="Session not found or not active")
    
    if not session.novnc_port:
        raise HTTPException(status_code=503, detail="noVNC not available")
    
    target_url = f"http://{session.novnc_host}:{session.novnc_port}/{path}"
    
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(target_url, timeout=10)
            
            # Determine content type
            content_type = resp.headers.get("content-type", "application/octet-stream")
            
            from fastapi.responses import Response
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                media_type=content_type,
            )
        except Exception as e:
            logger.error(f"noVNC proxy error: {e}")
            raise HTTPException(status_code=502, detail="Failed to proxy to noVNC")


# ============================================
# Live Browser View (HTML page with embedded noVNC)
# ============================================

# VNC password for the browser container (matches VNC_PASS in browser_orchestrator.py)
VNC_PASSWORD = "qabase"

@router.get("/sessions/{session_id}/view", response_class=HTMLResponse)
async def browser_view(session_id: str, request: Request):
    """
    Serve an HTML page with embedded noVNC client for live browser viewing.

    This page uses noVNC library to connect via the WebSocket proxy endpoint,
    which works through SSL/nginx reverse proxy setups (Dokku, etc.).
    """
    orchestrator = get_orchestrator()
    session = await orchestrator.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Browser session not found")

    if not session.is_active:
        return HTMLResponse(
            content=f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Browser Session - {session_id[:8]}</title>
                <style>
                    body {{ font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }}
                    .message {{ text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
                    .status {{ color: #666; margin-top: 1rem; }}
                </style>
            </head>
            <body>
                <div class="message">
                    <h2>Browser Session Unavailable</h2>
                    <p class="status">Status: {session.status.value}</p>
                    {f'<p class="error" style="color: red;">{session.error_message}</p>' if session.error_message else ''}
                </div>
            </body>
            </html>
            """,
            status_code=200,
        )

    # Build WebSocket URL for the VNC proxy endpoint
    # This works through nginx/Dokku SSL termination
    base_url = str(request.base_url).rstrip("/")
    ws_protocol = "wss" if request.url.scheme == "https" else "ws"
    # Handle X-Forwarded-Proto header for reverse proxy setups
    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    if forwarded_proto == "https":
        ws_protocol = "wss"

    # WebSocket URL for VNC proxy
    host = request.headers.get("host", "localhost")
    vnc_ws_url = f"{ws_protocol}://{host}/browser/sessions/{session_id}/vnc"

    # Serve a standalone noVNC client that connects via WebSocket proxy
    # Using noVNC from CDN (jsDelivr)
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Live Browser - {session_id[:8]}</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            html, body {{
                height: 100%;
                overflow: hidden;
            }}
            body {{
                font-family: system-ui, -apple-system, sans-serif;
                background: #1a1a2e;
                color: white;
                display: flex;
                flex-direction: column;
            }}
            .header {{
                background: #16213e;
                padding: 0.5rem 1rem;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid #0f3460;
                height: 48px;
                flex-shrink: 0;
            }}
            .header h1 {{
                font-size: 1rem;
                font-weight: 500;
            }}
            .status {{
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }}
            .status-dot {{
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #666;
                transition: background 0.3s;
            }}
            .status-dot.connected {{
                background: #4caf50;
            }}
            .status-dot.connecting {{
                background: #ff9800;
                animation: pulse 1s infinite;
            }}
            .status-dot.error {{
                background: #f44336;
            }}
            @keyframes pulse {{
                0%, 100% {{ opacity: 1; }}
                50% {{ opacity: 0.5; }}
            }}
            .controls {{
                display: flex;
                gap: 0.5rem;
            }}
            .btn {{
                padding: 0.25rem 0.75rem;
                border: 1px solid #0f3460;
                background: #16213e;
                color: white;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.875rem;
                text-decoration: none;
            }}
            .btn:hover {{
                background: #1a3a5c;
            }}
            .btn:disabled {{
                opacity: 0.5;
                cursor: not-allowed;
            }}
            #vnc-container {{
                flex: 1;
                position: relative;
                background: #000;
            }}
            #vnc-screen {{
                width: 100%;
                height: 100%;
            }}
            .loading {{
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
            }}
            .spinner {{
                width: 40px;
                height: 40px;
                border: 3px solid #333;
                border-top-color: #4caf50;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 1rem;
            }}
            @keyframes spin {{
                to {{ transform: rotate(360deg); }}
            }}
            .error-message {{
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                background: rgba(244, 67, 54, 0.9);
                padding: 2rem;
                border-radius: 8px;
                max-width: 400px;
            }}
        </style>
        <!-- noVNC core library from CDN -->
        <script type="module">
            import RFB from 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js';

            const wsUrl = "{vnc_ws_url}";
            const statusDot = document.getElementById('status-dot');
            const statusText = document.getElementById('status-text');
            const vncContainer = document.getElementById('vnc-container');
            const loading = document.getElementById('loading');
            const reconnectBtn = document.getElementById('reconnect-btn');

            let rfb = null;
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 5;

            function updateStatus(state, message) {{
                statusDot.className = 'status-dot ' + state;
                statusText.textContent = message;
            }}

            function showError(message) {{
                loading.innerHTML = `
                    <div class="error-message">
                        <h3>Connection Error</h3>
                        <p>${{message}}</p>
                        <button class="btn" onclick="window.connect()" style="margin-top: 1rem;">Retry</button>
                    </div>
                `;
                loading.style.display = 'block';
            }}

            function connect() {{
                if (rfb) {{
                    rfb.disconnect();
                }}

                loading.innerHTML = '<div class="loading"><div class="spinner"></div><p>Connecting to browser...</p></div>';
                loading.style.display = 'block';
                updateStatus('connecting', 'Connecting...');

                try {{
                    rfb = new RFB(document.getElementById('vnc-screen'), wsUrl, {{
                        credentials: {{ password: '' }},
                    }});

                    rfb.scaleViewport = true;
                    rfb.resizeSession = true;
                    rfb.showDotCursor = true;

                    rfb.addEventListener('connect', () => {{
                        console.log('VNC connected');
                        loading.style.display = 'none';
                        updateStatus('connected', 'Connected');
                        reconnectAttempts = 0;
                        reconnectBtn.disabled = false;
                    }});

                    rfb.addEventListener('disconnect', (e) => {{
                        console.log('VNC disconnected', e.detail);
                        if (e.detail.clean) {{
                            updateStatus('', 'Disconnected');
                        }} else {{
                            updateStatus('error', 'Connection lost');
                            if (reconnectAttempts < maxReconnectAttempts) {{
                                reconnectAttempts++;
                                setTimeout(connect, 2000);
                            }} else {{
                                showError('Connection lost. Click retry to reconnect.');
                            }}
                        }}
                    }});

                    rfb.addEventListener('securityfailure', (e) => {{
                        console.error('VNC security failure', e.detail);
                        showError('Security error: ' + (e.detail.reason || 'Unknown'));
                    }});

                }} catch (err) {{
                    console.error('VNC connection error:', err);
                    showError('Failed to connect: ' + err.message);
                    updateStatus('error', 'Error');
                }}
            }}

            function toggleFullscreen() {{
                if (document.fullscreenElement) {{
                    document.exitFullscreen();
                }} else {{
                    vncContainer.requestFullscreen();
                }}
            }}

            function reconnect() {{
                reconnectAttempts = 0;
                connect();
            }}

            // Expose functions globally
            window.connect = connect;
            window.toggleFullscreen = toggleFullscreen;
            window.reconnect = reconnect;

            // Auto-connect on load
            connect();
        </script>
    </head>
    <body>
        <div class="header">
            <h1>Live Browser View</h1>
            <div class="status">
                <span id="status-dot" class="status-dot"></span>
                <span id="status-text">Initializing...</span>
            </div>
            <div class="controls">
                <button class="btn" onclick="toggleFullscreen()">Fullscreen</button>
                <button id="reconnect-btn" class="btn" onclick="reconnect()">Reconnect</button>
            </div>
        </div>
        <div id="vnc-container">
            <div id="vnc-screen"></div>
            <div id="loading">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Connecting to browser...</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    """

    return HTMLResponse(content=html_content)
