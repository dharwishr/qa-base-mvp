#!/bin/bash
# Wait for VNC to start
sleep 5

# Start noVNC websockify proxy
# This bridges WebSocket connections from browsers to the VNC server
cd /opt/novnc
exec python3 -m websockify \
    --web /opt/novnc \
    ${NOVNC_PORT} \
    localhost:${VNC_PORT}
