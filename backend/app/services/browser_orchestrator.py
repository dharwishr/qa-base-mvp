"""
Browser Orchestrator - Manages isolated browser instances in Docker containers.

Features:
- Creates isolated browser instances using custom test-browser containers with VNC
- Exposes CDP URLs for browser-use (analysis) and Playwright/CDP runners (execution)
- Provides noVNC URLs for live browser streaming to frontend
- Manages container lifecycle (create, monitor, cleanup)
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from uuid import uuid4

import aiohttp
import docker
from docker.errors import NotFound, APIError
from docker.models.containers import Container

logger = logging.getLogger(__name__)


class BrowserPhase(str, Enum):
    """Phase of the browser session."""
    ANALYSIS = "analysis"
    EXECUTION = "execution"


class BrowserSessionStatus(str, Enum):
    """Status of a browser session."""
    PENDING = "pending"
    STARTING = "starting"
    READY = "ready"
    CONNECTED = "connected"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class BrowserSession:
    """Represents an isolated browser session in a Docker container."""
    id: str
    phase: BrowserPhase
    status: BrowserSessionStatus
    container_id: str | None = None
    container_name: str | None = None  # Container name for Docker network access
    container_ip: str | None = None  # Container IP on Docker network
    cdp_host: str = "127.0.0.1"  # Host for external access (host machine)
    cdp_port: int | None = None  # Mapped port for external access
    cdp_internal_port: int = 9222  # Internal port inside container
    cdp_ws_url: str | None = None  # Full WebSocket URL from /json/version
    novnc_host: str = "127.0.0.1"
    novnc_port: int | None = None
    vnc_port: int | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_used_at: datetime = field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    test_session_id: str | None = None
    test_run_id: str | None = None
    error_message: str | None = None
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "phase": self.phase.value,
            "status": self.status.value,
            "container_id": self.container_id,
            "container_name": self.container_name,
            "container_ip": self.container_ip,
            "cdp_host": self.cdp_host,
            "cdp_port": self.cdp_port,
            "cdp_ws_url": self.cdp_ws_url,
            "cdp_http_url": self.cdp_http_url,
            "novnc_host": self.novnc_host,
            "novnc_port": self.novnc_port,
            "vnc_port": self.vnc_port,
            "created_at": self.created_at.isoformat(),
            "last_used_at": self.last_used_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "test_session_id": self.test_session_id,
            "test_run_id": self.test_run_id,
            "error_message": self.error_message,
        }
    
    @property
    def cdp_url(self) -> str | None:
        """Get the CDP WebSocket URL for connecting to the browser."""
        # Return the discovered WebSocket URL if available, otherwise construct from port
        if self.cdp_ws_url:
            return self.cdp_ws_url
        if self.cdp_port:
            return f"ws://{self.cdp_host}:{self.cdp_port}"
        return None
    
    @property
    def cdp_http_url(self) -> str | None:
        """Get the CDP HTTP URL for browser automation."""
        if self.cdp_port:
            return f"http://{self.cdp_host}:{self.cdp_port}"
        return None
    
    @property
    def novnc_url(self) -> str | None:
        """Get the noVNC HTTP URL for live browser viewing."""
        if self.novnc_port:
            return f"http://{self.novnc_host}:{self.novnc_port}"
        return None
    
    @property
    def is_active(self) -> bool:
        """Check if the session is still active."""
        return self.status in (
            BrowserSessionStatus.READY,
            BrowserSessionStatus.CONNECTED,
        )
    
    @property
    def is_expired(self) -> bool:
        """Check if the session has expired."""
        if self.expires_at is None:
            return False
        return datetime.utcnow() > self.expires_at
    
    def is_inactive(self, inactivity_timeout: timedelta) -> bool:
        """Check if the session has been inactive for too long."""
        return datetime.utcnow() - self.last_used_at > inactivity_timeout
    
    def touch(self) -> None:
        """Update last_used_at to current time (mark as active)."""
        self.last_used_at = datetime.utcnow()


class BrowserOrchestrator:
    """
    Manages browser containers for test analysis and execution.
    
    Uses custom test-browser containers with built-in VNC/noVNC + CDP support.
    Each session gets an isolated browser container.
    """
    
    # Container configuration
    # Use custom test-browser image with direct CDP access (no Selenium)
    # Image hosted on Docker Hub: https://hub.docker.com/r/librekid/qa-test-browser
    DEFAULT_IMAGE = "librekid/qa-test-browser:latest"
    CONTAINER_CDP_PORT = 9222  # Chrome DevTools Protocol port
    CONTAINER_VNC_PORT = 5900  # VNC port
    CONTAINER_NOVNC_PORT = 7900  # noVNC web interface port
    DEFAULT_TTL_MINUTES = 30
    DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 5  # Kill browser after 5 min of inactivity
    MAX_SESSIONS_PER_PHASE = 10
    
    def __init__(
        self,
        image: str = DEFAULT_IMAGE,
        network_name: str = "qa-browser-network",
        session_ttl_minutes: int = DEFAULT_TTL_MINUTES,
        inactivity_timeout_minutes: int = DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
    ):
        self.image = image
        self.network_name = network_name
        self.session_ttl = timedelta(minutes=session_ttl_minutes)
        self.inactivity_timeout = timedelta(minutes=inactivity_timeout_minutes)
        self._sessions: dict[str, BrowserSession] = {}
        self._docker_client: docker.DockerClient | None = None
        self._cleanup_task: asyncio.Task | None = None
        self._running_in_docker = self._detect_docker_environment()
        
    def _detect_docker_environment(self) -> bool:
        """Detect if we're running inside a Docker container."""
        import os
        # Check for .dockerenv file or cgroup indicating Docker
        if os.path.exists("/.dockerenv"):
            return True
        try:
            with open("/proc/1/cgroup", "r") as f:
                return "docker" in f.read()
        except Exception:
            return False
        
    @property
    def docker_client(self) -> docker.DockerClient:
        """Get or create Docker client."""
        if self._docker_client is None:
            self._docker_client = docker.from_env()
        return self._docker_client
    
    def _ensure_network(self) -> None:
        """Ensure the Docker network exists for browser containers."""
        try:
            self.docker_client.networks.get(self.network_name)
            logger.debug(f"Docker network '{self.network_name}' already exists")
        except NotFound:
            logger.info(f"Creating Docker network '{self.network_name}'")
            self.docker_client.networks.create(
                self.network_name,
                driver="bridge",
                labels={"app": "qa-base"},
            )
    
    async def create_session(
        self,
        phase: BrowserPhase,
        test_session_id: str | None = None,
        test_run_id: str | None = None,
    ) -> BrowserSession:
        """
        Create a new browser session with an isolated container.
        
        Args:
            phase: Whether this is for analysis or execution
            test_session_id: Associated test session ID (for analysis)
            test_run_id: Associated test run ID (for execution)
            
        Returns:
            BrowserSession with connection details
        """
        session_id = str(uuid4())
        now = datetime.utcnow()
        
        session = BrowserSession(
            id=session_id,
            phase=phase,
            status=BrowserSessionStatus.PENDING,
            created_at=now,
            last_used_at=now,
            expires_at=now + self.session_ttl,
            test_session_id=test_session_id,
            test_run_id=test_run_id,
        )
        
        self._sessions[session_id] = session
        
        try:
            session.status = BrowserSessionStatus.STARTING
            
            # Ensure network exists
            self._ensure_network()
            
            # Create container
            container = await self._create_container(session)
            session.container_id = container.id
            
            # Get assigned ports
            await self._wait_for_container_ports(session, container)
            
            # Wait for browser to be ready
            await self._wait_for_browser_ready(session)
            
            session.status = BrowserSessionStatus.READY
            logger.info(
                f"Browser session {session_id} ready: "
                f"CDP={session.cdp_url}, noVNC={session.novnc_url}"
            )
            
        except Exception as e:
            session.status = BrowserSessionStatus.ERROR
            session.error_message = str(e)
            logger.error(f"Failed to create browser session {session_id}: {e}")
            
            # Cleanup failed container
            if session.container_id:
                await self._stop_container(session.container_id)
            
            raise
        
        return session
    
    async def _create_container(self, session: BrowserSession) -> Container:
        """Create and start a Docker container for the browser session."""
        container_name = f"browser-session-{session.id[:8]}"
        
        logger.info(f"Creating browser container: {container_name}")
        
        # Run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        container = await loop.run_in_executor(
            None,
            lambda: self.docker_client.containers.run(
                image=self.image,
                detach=True,
                name=container_name,
                environment={
                    # test-browser configuration
                    "SCREEN_WIDTH": "1920",
                    "SCREEN_HEIGHT": "1080",
                    "SCREEN_DEPTH": "24",
                },
                ports={
                    f"{self.CONTAINER_CDP_PORT}/tcp": ("0.0.0.0", 0),  # CDP port
                    f"{self.CONTAINER_NOVNC_PORT}/tcp": ("0.0.0.0", 0),  # noVNC web interface
                },
                labels={
                    "app": "qa-base",
                    "browser_session_id": session.id,
                    "browser_phase": session.phase.value,
                    "test_session_id": session.test_session_id or "",
                    "test_run_id": session.test_run_id or "",
                },
                network=self.network_name,
                shm_size="2g",  # Shared memory for Chrome
                mem_limit="2g",
                cpu_period=100000,
                cpu_quota=100000,  # 1 CPU
                # Don't try to pull the image - it should be built locally
                # This avoids "pull access denied" errors for local-only images
            )
        )
        
        return container
    
    async def _wait_for_container_ports(
        self,
        session: BrowserSession,
        container: Container,
        timeout: int = 30,
    ) -> None:
        """Wait for container to be running and extract port mappings and network info."""
        loop = asyncio.get_event_loop()
        start_time = datetime.utcnow()
        
        while (datetime.utcnow() - start_time).seconds < timeout:
            # Refresh container info
            await loop.run_in_executor(None, container.reload)
            
            if container.status == "running":
                network_settings = container.attrs.get("NetworkSettings", {})
                ports = network_settings.get("Ports", {})
                
                cdp_mapping = ports.get(f"{self.CONTAINER_CDP_PORT}/tcp")
                novnc_mapping = ports.get(f"{self.CONTAINER_NOVNC_PORT}/tcp")
                
                if cdp_mapping and novnc_mapping:
                    # Store host-mapped ports (for external access)
                    session.cdp_port = int(cdp_mapping[0]["HostPort"])
                    session.novnc_port = int(novnc_mapping[0]["HostPort"])
                    session.vnc_port = session.novnc_port  # noVNC proxies VNC
                    
                    # Store container name for Docker network access
                    session.container_name = container.name
                    
                    # Get container IP on the Docker network
                    networks = network_settings.get("Networks", {})
                    if self.network_name in networks:
                        session.container_ip = networks[self.network_name].get("IPAddress")
                    
                    logger.debug(
                        f"Container ports mapped: CDP={session.cdp_port}, noVNC={session.novnc_port}, "
                        f"Container IP={session.container_ip}"
                    )
                    return
            
            await asyncio.sleep(0.5)
        
        raise TimeoutError(f"Container did not start within {timeout} seconds")
    
    async def _wait_for_browser_ready(
        self,
        session: BrowserSession,
        timeout: int = 60,
    ) -> None:
        """Wait for CDP to be ready and discover the WebSocket URL."""
        start_time = datetime.utcnow()
        
        # Determine which address to use for checking readiness
        if self._running_in_docker and session.container_ip:
            check_host = session.container_ip
            check_port = self.CONTAINER_CDP_PORT
            logger.debug(f"Running in Docker, using container IP: {check_host}:{check_port}")
        else:
            check_host = session.cdp_host
            check_port = session.cdp_port
            logger.debug(f"Running locally, using host port: {check_host}:{check_port}")
        
        cdp_url = f"http://{check_host}:{check_port}"
        
        while (datetime.utcnow() - start_time).seconds < timeout:
            try:
                async with aiohttp.ClientSession() as http_session:
                    # Check CDP version endpoint
                    async with http_session.get(
                        f"{cdp_url}/json/version",
                        timeout=aiohttp.ClientTimeout(total=5)
                    ) as resp:
                        if resp.status == 200:
                            version_info = await resp.json()
                            ws_url = version_info.get("webSocketDebuggerUrl")
                            if ws_url:
                                # Rewrite WebSocket URL to use external port if needed
                                if self._running_in_docker and session.container_ip:
                                    # Keep internal URL for Docker-to-Docker communication
                                    session.cdp_ws_url = ws_url
                                else:
                                    # Rewrite to use host-mapped port
                                    import re
                                    session.cdp_ws_url = re.sub(
                                        r'ws://[^/]+',
                                        f'ws://{session.cdp_host}:{session.cdp_port}',
                                        ws_url
                                    )
                                logger.debug(f"CDP ready, WebSocket URL: {session.cdp_ws_url}")
                                return
                            
            except aiohttp.ClientError as e:
                logger.debug(f"CDP not ready yet: {e}")
            except asyncio.TimeoutError:
                logger.debug("CDP connection timed out, retrying...")
            except Exception as e:
                logger.debug(f"Error checking CDP: {e}")
            
            await asyncio.sleep(1)
        
        raise TimeoutError(f"CDP did not become ready within {timeout} seconds")
    
    async def get_session(self, session_id: str) -> BrowserSession | None:
        """Get a browser session by ID."""
        session = self._sessions.get(session_id)
        if session:
            session.last_used_at = datetime.utcnow()
        return session
    
    async def stop_session(self, session_id: str) -> bool:
        """Stop and remove a browser session."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        logger.info(f"Stopping browser session {session_id}")
        session.status = BrowserSessionStatus.STOPPING
        
        if session.container_id:
            await self._stop_container(session.container_id)
        
        session.status = BrowserSessionStatus.STOPPED
        del self._sessions[session_id]
        
        return True
    
    async def touch_session(self, session_id: str) -> bool:
        """Mark a session as active (update last_used_at)."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.touch()
        return True
    
    async def stop_all_sessions(self) -> int:
        """Stop all browser sessions. Returns count of stopped sessions."""
        session_ids = list(self._sessions.keys())
        stopped_count = 0
        
        for session_id in session_ids:
            try:
                if await self.stop_session(session_id):
                    stopped_count += 1
            except Exception as e:
                logger.error(f"Error stopping session {session_id}: {e}")
        
        # Also cleanup any orphaned containers not tracked in sessions
        await self.cleanup_orphaned_containers()
        
        logger.info(f"Stopped {stopped_count} browser sessions")
        return stopped_count
    
    async def _stop_container(self, container_id: str) -> None:
        """Stop and remove a Docker container."""
        try:
            loop = asyncio.get_event_loop()
            container = await loop.run_in_executor(
                None,
                lambda: self.docker_client.containers.get(container_id)
            )
            
            logger.debug(f"Stopping container {container_id}")
            await loop.run_in_executor(None, lambda: container.stop(timeout=5))
            
            logger.debug(f"Removing container {container_id}")
            await loop.run_in_executor(None, lambda: container.remove(force=True))
            
        except NotFound:
            logger.debug(f"Container {container_id} already removed")
        except Exception as e:
            logger.error(f"Error stopping container {container_id}: {e}")
    
    async def list_sessions(
        self,
        phase: BrowserPhase | None = None,
        active_only: bool = True,
    ) -> list[BrowserSession]:
        """List browser sessions, optionally filtered by phase.
        
        Also syncs with Docker containers to find sessions created by other processes (e.g., Celery).
        """
        # First sync with Docker to find sessions created by other processes
        await self._sync_sessions_from_docker()
        
        sessions = list(self._sessions.values())
        
        if phase:
            sessions = [s for s in sessions if s.phase == phase]
        
        if active_only:
            sessions = [s for s in sessions if s.is_active]
        
        return sessions
    
    async def _sync_sessions_from_docker(self) -> None:
        """Sync sessions from running Docker containers.
        
        This handles the case where sessions are created by other processes (e.g., Celery workers).
        """
        try:
            loop = asyncio.get_event_loop()
            containers = await loop.run_in_executor(
                None,
                lambda: self.docker_client.containers.list(
                    filters={"label": "app=qa-base"},
                )
            )
            
            for container in containers:
                session_id = container.labels.get("browser_session_id")
                if not session_id:
                    continue
                
                # Skip if we already have this session
                if session_id in self._sessions:
                    continue
                
                # Reconstruct session from container labels
                try:
                    phase_str = container.labels.get("browser_phase", "analysis")
                    test_session_id = container.labels.get("test_session_id")
                    test_run_id = container.labels.get("test_run_id")
                    
                    # Get port mappings
                    container.reload()
                    network_settings = container.attrs.get("NetworkSettings", {})
                    ports = network_settings.get("Ports", {})
                    cdp_mapping = ports.get(f"{self.CONTAINER_CDP_PORT}/tcp")
                    novnc_mapping = ports.get(f"{self.CONTAINER_NOVNC_PORT}/tcp")
                    
                    if not cdp_mapping or not novnc_mapping:
                        continue
                    
                    cdp_port = int(cdp_mapping[0]["HostPort"])
                    novnc_port = int(novnc_mapping[0]["HostPort"])
                    
                    # Get container IP
                    container_ip = None
                    networks = network_settings.get("Networks", {})
                    if self.network_name in networks:
                        container_ip = networks[self.network_name].get("IPAddress")
                    
                    # Reconstruct session
                    session = BrowserSession(
                        id=session_id,
                        phase=BrowserPhase(phase_str),
                        status=BrowserSessionStatus.READY,
                        created_at=datetime.utcnow(),  # Approximate
                        last_used_at=datetime.utcnow(),
                        expires_at=datetime.utcnow() + self.session_ttl,
                        container_id=container.id,
                        container_name=container.name,
                        container_ip=container_ip,
                        cdp_port=cdp_port,
                        novnc_port=novnc_port,
                        vnc_port=novnc_port,
                        test_session_id=test_session_id,
                        test_run_id=test_run_id,
                    )
                    
                    # Set CDP URL
                    if self._running_in_docker and container_ip:
                        session._cdp_url = f"ws://{container_ip}:{self.CONTAINER_CDP_PORT}"
                    else:
                        session._cdp_url = f"ws://{session.cdp_host}:{cdp_port}"
                    
                    self._sessions[session_id] = session
                    logger.info(f"Synced browser session from Docker: {session_id}")
                    
                except Exception as e:
                    logger.warning(f"Failed to reconstruct session from container {container.id}: {e}")
                    
        except Exception as e:
            logger.warning(f"Failed to sync sessions from Docker: {e}")
    
    async def cleanup_expired_sessions(self) -> int:
        """Clean up expired and inactive browser sessions. Returns count of cleaned sessions."""
        sessions_to_cleanup = []
        
        for session_id, session in self._sessions.items():
            # Check for expired sessions
            if session.is_expired:
                sessions_to_cleanup.append((session_id, "expired"))
                continue
            
            # Check for inactive sessions (no activity in last 5 minutes)
            if session.is_active and session.is_inactive(self.inactivity_timeout):
                sessions_to_cleanup.append((session_id, "inactive"))
                continue
            
            # Check for error/stopped sessions
            if session.status in (BrowserSessionStatus.ERROR, BrowserSessionStatus.STOPPED):
                sessions_to_cleanup.append((session_id, "stopped"))
        
        for session_id, reason in sessions_to_cleanup:
            try:
                logger.info(f"Cleaning up browser session {session_id} (reason: {reason})")
                await self.stop_session(session_id)
            except Exception as e:
                logger.error(f"Error cleaning up session {session_id}: {e}")
        
        if sessions_to_cleanup:
            logger.info(f"Cleaned up {len(sessions_to_cleanup)} browser sessions")
        
        return len(sessions_to_cleanup)
    
    async def cleanup_orphaned_containers(self) -> int:
        """Clean up any orphaned browser containers. Returns count of cleaned."""
        try:
            loop = asyncio.get_event_loop()
            containers = await loop.run_in_executor(
                None,
                lambda: self.docker_client.containers.list(
                    filters={"label": "app=qa-base"},
                    all=True,
                )
            )
            
            count = 0
            for container in containers:
                session_id = container.labels.get("browser_session_id")
                
                # If session doesn't exist in our tracking, it's orphaned
                if session_id not in self._sessions:
                    logger.info(f"Cleaning up orphaned container: {container.name}")
                    await self._stop_container(container.id)
                    count += 1
            
            return count
            
        except Exception as e:
            logger.error(f"Error cleaning up orphaned containers: {e}")
            return 0
    
    async def start_cleanup_task(self, interval_seconds: int = 60) -> None:
        """Start background task for periodic cleanup."""
        async def cleanup_loop():
            while True:
                try:
                    await asyncio.sleep(interval_seconds)
                    await self.cleanup_expired_sessions()
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error(f"Error in cleanup task: {e}")
        
        self._cleanup_task = asyncio.create_task(cleanup_loop())
        logger.info("Browser session cleanup task started")
    
    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            logger.info("Browser session cleanup task stopped")
    
    async def shutdown(self) -> None:
        """Shutdown the orchestrator and clean up all resources."""
        logger.info("Shutting down browser orchestrator...")
        
        await self.stop_cleanup_task()
        
        # Stop all active sessions
        session_ids = list(self._sessions.keys())
        for session_id in session_ids:
            try:
                await self.stop_session(session_id)
            except Exception as e:
                logger.error(f"Error stopping session {session_id}: {e}")
        
        # Clean up any orphaned containers
        await self.cleanup_orphaned_containers()
        
        logger.info("Browser orchestrator shutdown complete")


# Global orchestrator instance
_orchestrator: BrowserOrchestrator | None = None


def get_orchestrator() -> BrowserOrchestrator:
    """Get the global browser orchestrator instance."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = BrowserOrchestrator()
    return _orchestrator


async def init_orchestrator() -> BrowserOrchestrator:
    """Initialize the global orchestrator and start cleanup task."""
    orchestrator = get_orchestrator()
    await orchestrator.start_cleanup_task()
    return orchestrator


async def shutdown_orchestrator() -> None:
    """Shutdown the global orchestrator."""
    global _orchestrator
    if _orchestrator:
        await _orchestrator.shutdown()
        _orchestrator = None
