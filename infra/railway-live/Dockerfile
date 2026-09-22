# SG Academia · servidor de transmisión propio para Railway (un solo contenedor):
# MediaMTX (RTMP/WHIP → HLS + WebRTC) + ffmpeg (relay Opus) + Caddy (un solo puerto HTTP) + coturn (WebRTC por TCP)
FROM caddy:2-alpine AS caddy
FROM golang:1.22-alpine AS mux
WORKDIR /src
COPY mux/ .
RUN CGO_ENABLED=0 go build -o /mux .
FROM bluenviron/mediamtx:latest-ffmpeg
RUN apk add --no-cache coturn gettext bash
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=mux /mux /usr/bin/mux
COPY mediamtx.template.yml /mediamtx.template.yml
COPY Caddyfile /etc/caddy/Caddyfile
COPY hooks /hooks
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /hooks/*.sh && mkdir -p /recordings
ENV PORT=8080
EXPOSE 8080 9000
ENTRYPOINT ["/entrypoint.sh"]
# sleep mode habilitado en Railway (se despierta con la primera conexión)
