#!/bin/bash
# Wait for VNC to start
sleep 5

# Start noVNC websockify proxy using python3 module
cd /opt/novnc
exec python3 -m websockify \
    --web /opt/novnc \
    ${NOVNC_PORT} \
    localhost:${VNC_PORT}
