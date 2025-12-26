#!/bin/bash
# Wait for Xvfb to start
sleep 2

# Start Fluxbox window manager
exec fluxbox -display ${DISPLAY}
