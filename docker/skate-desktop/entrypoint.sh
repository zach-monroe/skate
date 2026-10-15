#!/bin/bash
set -e

WIDTH="${RESOLUTION_WIDTH:-1024}"
HEIGHT="${RESOLUTION_HEIGHT:-768}"

Xvfb :1 -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &

for i in $(seq 1 50); do
  xdpyinfo -display :1 >/dev/null 2>&1 && break
  sleep 0.1
done

openbox-session &
x11vnc -display :1 -forever -shared -nopw -rfbport 5900 -quiet &
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

sleep 1
firefox-esr --no-remote about:blank &

wait -n
