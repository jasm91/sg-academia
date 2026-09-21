#!/usr/bin/env bash
# Instalación en un VPS Ubuntu/Debian limpio: Docker + firewall + arranque. Correr como root.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo ">> Editá infra/.env (dominios, LMS_URL, secretos) y volvé a correr."; exit 1; }
set -a; . ./.env; set +a
gen() { head -c 24 /dev/urandom | base64 | tr -d '/+=' ; }
for v in JICOFO_AUTH_PASSWORD JVB_AUTH_PASSWORD JIGASI_XMPP_PASSWORD JIBRI_RECORDER_PASSWORD JIBRI_XMPP_PASSWORD; do
  if [ -z "${!v:-}" ]; then sed -i "s/^$v=.*/$v=$(gen)/" .env; fi
done
if [ -z "${PUBLIC_IP:-}" ]; then IP=$(curl -4s https://ifconfig.me || true); sed -i "s/^PUBLIC_IP=.*/PUBLIC_IP=$IP/" .env; fi
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
if command -v ufw >/dev/null; then
  ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 443/udp
  ufw allow 1935/tcp; ufw allow 8890/udp; ufw allow 8189/udp; ufw allow 8189/tcp; ufw allow 10000/udp
  ufw --force enable
fi
mkdir -p recordings
docker compose pull
docker compose up -d
echo ">> Listo. Jitsi: https://${MEET_DOMAIN}  ·  Live: https://${LIVE_DOMAIN}"
echo ">> En Railway (academia-app) cargá: JITSI_DOMAIN=${MEET_DOMAIN} JITSI_APP_ID=${JITSI_APP_ID} JITSI_APP_SECRET=... LIVE_DOMAIN=${LIVE_DOMAIN} LIVE_SECRET=..."
