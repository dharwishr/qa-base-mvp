#!/bin/bash
# Wait for Xvfb to start
sleep 3

# Create password file (empty password)
mkdir -p ~/.vnc
echo "" | vncpasswd -f > ~/.vnc/passwd
chmod 600 ~/.vnc/passwd

# Start TigerVNC's x0vncserver to share the existing Xvfb display
exec x0vncserver -display ${DISPLAY} \
    -rfbport ${VNC_PORT} \
    -SecurityTypes None \
    -AlwaysShared
