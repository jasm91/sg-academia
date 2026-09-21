#!/bin/sh
# Avisa a la app de eventos de la transmisión. Variables de MediaMTX: MTX_PATH, MTX_SEGMENT_PATH.
EVENT="$1"
URL=""
if [ "$EVENT" = "segment" ] && [ -n "$MTX_SEGMENT_PATH" ]; then
  REL=$(echo "$MTX_SEGMENT_PATH" | sed 's#^/recordings/##')
  URL="https://${LIVE_DOMAIN}/rec/${REL}"
fi
wget -q -O- --header="Content-Type: application/json" --header="x-live-secret: ${LIVE_SECRET}" \
  --post-data="{\"event\":\"${EVENT}\",\"path\":\"${MTX_PATH}\",\"file\":\"${MTX_SEGMENT_PATH}\",\"url\":\"${URL}\"}" \
  "${LMS_URL}/api/hooks/live/event" >/dev/null 2>&1 || true
