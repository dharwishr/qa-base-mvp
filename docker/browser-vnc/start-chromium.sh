#!/bin/bash
# Wait for display to be ready
sleep 4

# Start Chromium with remote debugging enabled on internal port 9223
# (socat will forward from external port to this internal port)
exec chromium \
    --no-sandbox \
    --disable-gpu \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --disable-background-networking \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --disable-translate \
    --disable-popup-blocking \
    --metrics-recording-only \
    --no-first-run \
    --safebrowsing-disable-auto-update \
    --remote-debugging-port=9223 \
    --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} \
    --window-position=0,0 \
    --start-maximized \
    --user-data-dir=/tmp/chromium-data \
    about:blank
