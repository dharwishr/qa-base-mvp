#!/bin/bash
# Wait for display to be ready
sleep 4

# Enable software rendering for WebGL2 support
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe

# Start Chromium with remote debugging enabled
# CDP port 9223 is internal, socat will forward to external port 9222
# WebGL2 is enabled via software rendering (SwiftShader/ANGLE)
exec chromium \
    --no-sandbox \
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
    --remote-debugging-address=127.0.0.1 \
    --remote-allow-origins=* \
    --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} \
    --window-position=0,0 \
    --start-maximized \
    --user-data-dir=/tmp/chromium-data \
    --enable-webgl \
    --enable-webgl2 \
    --use-gl=angle \
    --use-angle=swiftshader \
    --ignore-gpu-blocklist \
    --enable-gpu-rasterization \
    about:blank
