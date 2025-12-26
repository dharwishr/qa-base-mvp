#!/bin/bash
# Wait for Xvfb to start
sleep 3

# Start x11vnc to share the existing Xvfb display
exec x11vnc \
    -display ${DISPLAY} \
    -rfbport ${VNC_PORT} \
    -nopw \
    -shared \
    -forever \
    -rfbwait 30000 \
    -o /tmp/x11vnc.log
