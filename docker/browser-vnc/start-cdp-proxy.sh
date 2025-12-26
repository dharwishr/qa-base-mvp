#!/bin/bash
# Wait for Chromium to start
sleep 6

# Forward CDP port from localhost to all interfaces
# This is needed because Chromium ignores --remote-debugging-address in some versions
exec socat TCP-LISTEN:${CDP_PORT},bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9223
