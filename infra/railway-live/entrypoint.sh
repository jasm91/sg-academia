#!/bin/bash
set -e
: "${LMS_URL:?falta LMS_URL}"; : "${LIVE_SECRET:?falta LIVE_SECRET}"; : "${LIVE_DOMAIN:?falta LIVE_DOMAIN}"
export TURN_USER="${TURN_USER:-sga}" TURN_PASS="${TURN_PASS:-$LIVE_SECRET}" TURN_PUBLIC_HOST="${TURN_PUBLIC_HOST:-localhost}" TURN_PUBLIC_PORT="${TURN_PUBLIC_PORT:-3478}"
envsubst < /mediamtx.template.yml > /mediamtx.yml
IP=$(hostname -i | awk '{print $1}')
# coturn: TURN por TCP (Railway no tiene UDP). El relay queda dentro del contenedor y llega a MediaMTX por red local.
cat > /turnserver.conf <<CONF
listening-port=3478
listening-ip=0.0.0.0
relay-ip=${IP}
min-port=49160
max-port=49400
lt-cred-mech
user=${TURN_USER}:${TURN_PASS}
realm=sg-academia
no-tls
no-dtls
no-cli
fingerprint
no-multicast-peers
allow-loopback-peers
CONF
turnserver -c /turnserver.conf --log-file=stdout --simple-log &
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
MUX_PORT=9000 mux &
if [ -n "${LIVE_SELFTEST:-}" ]; then
  ( sleep 5; while true; do ffmpeg -hide_banner -loglevel error -re -f lavfi -i "testsrc2=size=854x480:rate=25" -f lavfi -i "sine=frequency=440" -c:v libx264 -preset veryfast -tune zerolatency -g 50 -pix_fmt yuv420p -c:a aac -ar 44100 -f flv "rtmp://127.0.0.1:1935/${LIVE_SELFTEST}"; sleep 5; done ) &
fi
exec /mediamtx /mediamtx.yml
