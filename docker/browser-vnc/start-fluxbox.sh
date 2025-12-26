#!/bin/bash
# Wait for Xvfb to start
sleep 2
exec fluxbox -display ${DISPLAY}
