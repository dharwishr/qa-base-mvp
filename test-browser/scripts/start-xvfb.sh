#!/bin/bash
# Start Xvnc (TigerVNC) which provides both X server and VNC in one
# This replaces Xvfb and gives us built-in VNC support
exec Xvnc ${DISPLAY} \
    -geometry ${SCREEN_WIDTH}x${SCREEN_HEIGHT} \
    -depth ${SCREEN_DEPTH} \
    -rfbport ${VNC_PORT} \
    -SecurityTypes None \
    -AlwaysShared \
    -AcceptKeyEvents \
    -AcceptPointerEvents \
    -AcceptSetDesktopSize \
    -SendCutText \
    -AcceptCutText
