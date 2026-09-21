#!/bin/sh
# Relay: toma el aula publicada (RTMP/SRT con AAC) y republica <aula>rtc con audio Opus para WebRTC (WHEP).
# Video se copia sin recodificar (H264). Corre mientras el aula esté publicando (runOnReady + restart).
case "$MTX_PATH" in *rtc) exit 0;; esac
"$(dirname "$0")/event.sh" ready
exec ffmpeg -hide_banner -loglevel warning -rtsp_transport tcp -i "rtsp://relay:${LIVE_SECRET}@127.0.0.1:8554/$MTX_PATH" \
  -c:v copy -c:a libopus -b:a 96k -ar 48000 -ac 2 -application lowdelay \
  -f rtsp -rtsp_transport tcp "rtsp://relay:${LIVE_SECRET}@127.0.0.1:8554/${MTX_PATH}rtc"
