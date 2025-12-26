#!/bin/bash
# Wait for Chromium to start
sleep 6

# Forward CDP port from localhost to all interfaces
# This is needed because Chromium binds to 127.0.0.1 only
# socat listens on 0.0.0.0:9222 and forwards to 127.0.0.1:9223
exec socat TCP-LISTEN:${CDP_PORT},bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9223
