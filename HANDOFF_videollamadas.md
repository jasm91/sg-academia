# HANDOFF — Videollamadas, aulas en vivo y transmisión propia (SG Academia)

Estado al 23-09-2026 · app v0.3.0 · repo `github.com/jasm91/sg-academia` (push a `main` → Railway deploya)

## 1. Qué hay y en qué estado

| Función | Motor | Estado | Bloqueo |
|---|---|---|---|
| Aulas bidireccionales (cámara/mic de todos) | Jitsi Meet embebido (`external_api.js`) | Código listo para 3 proveedores | El default (meet.jit.si público) corta a los **5 minutos** cuando está embebido → hay que activar JaaS o Jitsi propio |
| Visor de soporte (tenant comparte pantalla + audio + chat con SG) | Misma sala Jitsi, `startScreenSharing` | Código listo | Mismo bloqueo |
| Transmisión propia (1 → muchos, tipo YouTube Live) | MediaMTX en Railway (`academia-live`) | **Funcionando en producción**, probado E2E | Ninguno |
| Chat en vivo | SSE propio (`/api/aulas/:id/chat/stream`) | Funcionando | — |
| Grabación → lección | MediaMTX graba fMP4, hook publica lección | Funcionando | — |
| Nivel 3: sala propia con LiveKit (UI tipo Zoom) | — | No empezado | Necesita VPS (UDP) |

Ambos servicios Railway están en **sleep mode** (se despiertan con la primera request, 2–5 s).

## 2. Cómo se resuelve el proveedor de aulas (`live.js → jitsiProvider()`)

Prioridad: `JITSI_DOMAIN`+`JITSI_APP_ID`+`JITSI_APP_SECRET` (propio) → `JAAS_APP_ID`+`JAAS_KEY_ID`+`JAAS_PRIVATE_KEY` (8x8) → meet.jit.si público (no usable en producción).

- **Propio**: JWT HS256 solo para moderadores (`selfToken`); alumnos entran como invitados y esperan al instructor (lobby). Servidor: `infra/docker-compose.yml` (jitsi web/prosody/jicofo/jvb + Caddy TLS), `infra/install.sh`. Requiere VPS con UDP 10000 y DNS `meet.<dominio>` sin proxy Cloudflare.
- **JaaS**: JWT RS256 con `kid` (`jaasToken`), moderador por flag; sala = `<appId>/<room>`. Gratis hasta 25 participantes. **Camino más rápido para destrabar hoy**: cuenta en jaas.8x8.vc → API Keys → cargar 3 variables en Railway (`academia-app`). La clave privada va con `\n` literales o multilínea; el código hace `.replace(/\\n/g, '\n')`.

El front (`public/live.js`) carga el script del proveedor y monta `JitsiMeetExternalAPI` con `roomName`, `jwt`, toolbar según rol. Soporte: `#/admin/soporte` (tenant) y `#/superadmin/soporte/:id` (SG, moderador).

## 3. Transmisión propia — arquitectura en Railway

Servicio `academia-live` (`infra/railway-live/`, root directory `/infra/railway-live`, Dockerfile):
- **MediaMTX** v1.21: RTMP `:1935`, HLS `127.0.0.1:8888`, WebRTC `127.0.0.1:8889`, RTSP interno `127.0.0.1:8554`. Auth por callback HTTP a la app (`MTX_AUTHHTTPADDRESS` = `LMS_URL/api/hooks/live/auth`).
- **ffmpeg relay** (`hooks/relay.sh`, `runOnAvailable`): republica `aulaN` → `aulaNrtc` con audio Opus (WebRTC no acepta el AAC de OBS). Video se copia. También dispara `event.sh ready`.
- **Caddy** en `$PORT` (8080): `/x/whep|whip` → 8889, `*.m3u8|*.mp4|*.ts|*.m4s` → 8888, `/rec/*` → `/recordings` (volumen `grabaciones`), CORS `*`.
- **coturn** TCP `:3478` (Railway no tiene UDP): TURN para que WebRTC atraviese. Relay interno al contenedor.
- **mux** (Go, `mux/main.go`) en `:9000`: Railway permite **un solo TCP proxy**; reparte por primer byte: `0x03` → RTMP, resto → TURN. TCP proxy actual: `acela.proxy.rlwy.net:45421`.

Flujo: OBS → `rtmp://acela.proxy.rlwy.net:45421/aulaN?user=obs&pass=<stream_key>` → auth (clave del aula) → `relay.sh` avisa `ready` → app marca `live` y emite por SSE → alumnos: `POST /api/aulas/:id/join` devuelve `whep` (aulaNrtc, token JWT 8 h firmado con `LIVE_SECRET`), `hls`, `ice` (STUN + TURN) → player intenta WebRTC (WHEP), cae a HLS (hls.js/nativo). Al cortar: `notready` → estado `scheduled` (o `ended` si pasó la hora) ; `segment` → `recording_url` + lección en sección "Grabaciones de aulas".

Hooks (`routes/hooks.js`): `POST /api/hooks/live/auth` (body de MediaMTX: action/path/user/password/token/query/ip), `POST /api/hooks/live/event` (header `x-live-secret`). Regla de paths: `aula<id>` publica con `stream_key`; `aula<id>rtc` solo lo publica `relay` local con `LIVE_SECRET`; lectura con JWT `kind: 'read'` y `path` base.

Limitaciones en Railway: sin SRT (UDP); WebRTC solo vía TURN-TCP (si falla, HLS ~3–5 s, garantizado); egress cobrado ($0,05/GB ≈ $9 por clase de 100 alumnos × 2 h). En VPS (infra/docker-compose.yml) desaparecen las tres.

## 4. Variables de entorno

`academia-app` (`91ae4e81-…`): `LIVE_DOMAIN=academia-live-production.up.railway.app`, `LIVE_SECRET`, `LIVE_RTMP_HOST=acela.proxy.rlwy.net`, `LIVE_RTMP_PORT=45421`, `LIVE_TURN_URL=turn:acela.proxy.rlwy.net:45421?transport=tcp`, `LIVE_TURN_USER`, `LIVE_TURN_PASS`. Opcionales: `LIVE_SCHEME` (http en local), `LIVE_SRT_PORT` (solo VPS), `JITSI_*` / `JAAS_*`, `CF_STREAM_CUSTOMER_CODE`.

`academia-live` (`f5167546-…`): `LMS_URL`, `LIVE_SECRET` (igual que la app), `LIVE_DOMAIN`, `TURN_USER`, `TURN_PASS`, `TURN_PUBLIC_HOST`, `TURN_PUBLIC_PORT`, `PORT=8080`. `LIVE_SELFTEST=aulaN?user=obs&pass=KEY` publica un patrón de prueba (dejar vacío en normal).

Railway: proyecto `sg-academia` `bf5df7ff-e60e-4a59-9004-9fd34d01b31b`, env production `32a80ee6-4a76-40d8-9761-fa2533945f1c`.

## 5. Archivos clave

`live.js` (proveedores, tokens, payload de acceso, auth MediaMTX) · `routes/hooks.js` · `routes/api.js` (aulas, join, chat SSE) · `routes/admin.js` (CRUD aulas, credenciales OBS, grabación manual, soporte) · `routes/super.js` (soporte SG) · `public/live.js` (UI aulas, player WHEP/HLS, chat, soporte, admin aulas) · `public/super.js` (visor) · `infra/railway-live/*` (contenedor Railway) · `infra/docker-compose.yml`, `infra/mediamtx.yml`, `infra/hooks/*`, `infra/install.sh` (VPS) · `db.js` (tablas `classrooms`, `classroom_attendance`, `chat_messages`, `support_sessions`).

## 6. Pruebas

- `node test/smoke.js` (61 checks; `BASE=` para prod, `ADMIN_EMAIL/ADMIN_PASSWORD/SUPER_TOKEN`).
- `bash test/stream-e2e.sh` (11 checks): necesita LMS local con `LIVE_DOMAIN=localhost:18889 LIVE_SCHEME=http LIVE_SECRET=livesecret123 LIVE_RTMP_PORT=11935` y un MediaMTX local (binario compilado desde el proxy de Go: `proxy.golang.org/github.com/bluenviron/mediamtx/@v/v1.21.1.zip`, `go build`) con `infra/mediamtx.yml` adaptado a puertos 1xxxx y hooks apuntando a `http://127.0.0.1:3000`. Publica con ffmpeg y verifica auth, estado, HLS con/sin token, chat, grabación.
- Verificado en producción el 21-09: aula #7 "Prueba transmisión propia" → `live`, HLS 200 con token / 401 sin, WHEP 201 (H264+Opus), grabación servida en `/rec/aula7/…mp4` y publicada como lección #12.
- No verificable en sandbox: decodificación de video (Chromium headless sin H264/AAC) y conectividad TURN real. Probar en Chrome: el pill del aula dice "WebRTC" o "HLS".

## 7. Próximos pasos (en orden)

1. **Destrabar aulas/soporte**: JaaS (10 min, gratis) o VPS (`infra/`, €8/mes). Cargar variables; no hay cambios de código.
2. Probar transmisión real con OBS en el aula #7 desde Chrome (WebRTC vs HLS) y una grabación completa.
3. Con VPS: mover `academia-live` al VPS (mismo `mediamtx.yml`, sin coturn/mux), habilitar SRT, ahorrar egress.
4. Nivel 3 (LiveKit + UI propia): estimado 40–60 h, requiere VPS.
5. Pendientes menores: reconexión automática del player al volver `live` (hoy reintenta al recibir evento SSE), viewers reales desde MediaMTX API (`/v3/paths/list`), borrar grabaciones viejas del volumen (hoy `recordDeleteAfter: 720h`), subir grabaciones a Bunny.

## 8. Seguridad

Credenciales del stream: `stream_key` por aula (regenerable desde "OBS → Regenerar clave"). Tokens de lectura expiran en 8 h. `LIVE_SECRET` compartido app↔MediaMTX: rotarlo cambia ambos servicios. Tokens de GitHub/Railway/superadmin usados en la sesión del 21-09 quedaron en el chat: **revocar/rotar**.
