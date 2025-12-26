# Test Browser - Chrome + CDP + VNC Docker Image

A Docker image providing a Chrome browser with Chrome DevTools Protocol (CDP) support and VNC for remote viewing.

## Features

- **Chromium Browser**: Latest Chromium with remote debugging enabled
- **CDP Support**: Chrome DevTools Protocol accessible on port 9222
- **VNC Server**: TigerVNC for remote desktop viewing (port 5900)
- **noVNC**: Web-based VNC client (port 7900) - no VNC client needed
- **Demo Page**: HTML/CSS/JS demo to interact with the browser via CDP

## Quick Start

### Build and Run

```bash
cd test-browser
docker-compose up --build
```

### Access the Browser

- **noVNC (Web)**: Open http://localhost:7900 in your browser
- **VNC Client**: Connect to `localhost:5900`
- **CDP Endpoint**: `http://localhost:9222`

### Demo Page

Open `demo/index.html` in your browser to access the CDP control panel.

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 5900 | VNC | Raw VNC protocol (use VNC client) |
| 7900 | noVNC | Web-based VNC viewer |
| 9222 | CDP | Chrome DevTools Protocol |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SCREEN_WIDTH` | 1920 | Virtual screen width |
| `SCREEN_HEIGHT` | 1080 | Virtual screen height |
| `SCREEN_DEPTH` | 24 | Color depth |
| `VNC_PORT` | 5900 | VNC server port |
| `NOVNC_PORT` | 7900 | noVNC web server port |
| `CDP_PORT` | 9222 | CDP port |

## CDP API Examples

### Get Browser Info

```bash
curl http://localhost:9222/json/version
```

### List Targets

```bash
curl http://localhost:9222/json
```

### JavaScript Example

```javascript
// Connect to CDP
const response = await fetch('http://localhost:9222/json');
const targets = await response.json();
const wsUrl = targets[0].webSocketDebuggerUrl;

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
    // Navigate to a URL
    ws.send(JSON.stringify({
        id: 1,
        method: 'Page.navigate',
        params: { url: 'https://example.com' }
    }));
};

ws.onmessage = (event) => {
    console.log('Response:', JSON.parse(event.data));
};
```

### Take Screenshot

```javascript
// After connecting...
ws.send(JSON.stringify({
    id: 2,
    method: 'Page.captureScreenshot',
    params: { format: 'png' }
}));
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Docker Container                   │
│                                                     │
│  ┌─────────┐     ┌─────────┐     ┌─────────────┐   │
│  │  Xvfb   │────▶│ Fluxbox │────▶│  Chromium   │   │
│  │ :99     │     │  (WM)   │     │ (CDP:9223)  │   │
│  └────┬────┘     └─────────┘     └──────┬──────┘   │
│       │                                  │          │
│       ▼                                  ▼          │
│  ┌─────────┐                       ┌──────────┐    │
│  │  VNC    │                       │  socat   │    │
│  │ :5900   │                       │  proxy   │    │
│  └────┬────┘                       └────┬─────┘    │
│       │                                  │          │
│       ▼                                  │          │
│  ┌─────────┐                            │          │
│  │ noVNC   │                            │          │
│  │ :7900   │                            │          │
│  └─────────┘                            │          │
└───────┼──────────────────────────────────┼──────────┘
        │                                  │
        ▼                                  ▼
   Web Browser                        CDP Client
   (VNC view)                      (localhost:9222)
```

## Files

```
test-browser/
├── Dockerfile              # Docker image definition
├── docker-compose.yaml     # Compose file for easy deployment
├── supervisord.conf        # Process manager configuration
├── scripts/
│   ├── start-xvfb.sh      # Virtual framebuffer startup
│   ├── start-fluxbox.sh   # Window manager startup
│   ├── start-vnc.sh       # VNC server startup
│   ├── start-novnc.sh     # noVNC proxy startup
│   ├── start-chromium.sh  # Chrome with CDP startup
│   └── start-cdp-proxy.sh # CDP port forwarder
├── demo/
│   ├── index.html         # Demo control panel
│   ├── style.css          # Demo styles
│   └── app.js             # CDP interaction logic
└── README.md              # This file
```

## Troubleshooting

### CDP Connection Refused

1. Wait for the container to fully start (~10 seconds)
2. Check container logs: `docker-compose logs -f`
3. Verify CDP is running: `curl http://localhost:9222/json/version`

### VNC Not Loading

1. Check noVNC is running: Open http://localhost:7900 directly
2. Try refreshing the connection
3. Check if port 7900 is accessible

### Browser Not Responding

1. Check container memory: `docker stats test-browser`
2. Increase `shm_size` in docker-compose.yaml
3. Restart the container: `docker-compose restart`

## Building Custom Image

```bash
# Build the image
docker build -t test-browser .

# Run with custom ports
docker run -d \
    -p 5901:5900 \
    -p 7901:7900 \
    -p 9223:9222 \
    -e SCREEN_WIDTH=1280 \
    -e SCREEN_HEIGHT=720 \
    --shm-size=2g \
    test-browser
```
