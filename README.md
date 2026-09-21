# SG Academia

LMS de SG Bolivia: cursos pregrabados (Bunny Stream / YouTube / Vimeo), quizzes, certificados PDF verificables y cobro por QR Baneco (BEC QR CONNECT) con acreditación automática. Un solo servicio Node/Express que sirve la SPA y la API; Postgres.

## Correr local
```
npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/academia node server.js
npm test   # smoke E2E contra http://localhost:3000
```

## Variables de entorno
| Variable | Uso |
|---|---|
| `DATABASE_URL` | Postgres (Railway la inyecta con `${{Postgres.DATABASE_URL}}`) |
| `JWT_SECRET` | firma de sesiones |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | admin inicial (solo se crea si no existe ningún admin) |
| `PUBLIC_URL` | URL pública (para el QR de verificación del certificado) |
| `SEED_DEMO=0` | no crear el curso demo |
| `BANECO_BASE_URL`, `BANECO_USER`, `BANECO_PASSWORD`, `BANECO_AES_KEY` (32 chars), `BANECO_ACCOUNT`, `BANECO_BRANCH` | API QR Baneco. Sin ellas, modo manual (QR estático + comprobante) |
| `BANECO_POLL_MINUTES` | poller de órdenes QR (default 3) |
| `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY`, `BUNNY_TOKEN_KEY` | Bunny Stream: listado/subida desde el admin y embed firmado |
| `SUPERADMIN_TOKEN` | acceso al panel de plataforma `/#/superadmin` (tenants, soporte, ventas) |
| `JAAS_APP_ID`, `JAAS_KEY_ID`, `JAAS_PRIVATE_KEY` | Jitsi as a Service (8x8) para aulas y soporte sin login del instructor; sin ellas se usa meet.jit.si público |
| `CF_STREAM_CUSTOMER_CODE` | Cloudflare Stream Live (aulas modo `cloudflare`) |
| `JITSI_DOMAIN`, `JITSI_APP_ID`, `JITSI_APP_SECRET` | **Jitsi propio** (VPS, ver `infra/`): aulas y soporte con JWT HS256 del LMS; tiene prioridad sobre JaaS |
| `LIVE_DOMAIN`, `LIVE_SECRET` (`LIVE_SCHEME`, `LIVE_RTMP_PORT`, `LIVE_SRT_PORT` opcionales) | **Transmisión propia** (MediaMTX en el VPS): aulas modo `stream`, auth por callback, hooks de estado y grabación |

## Flujo de cobro
Orden → `generateQR` (monto exacto, vence mañana, singleUse) → el alumno paga desde cualquier app (QR interoperable BCB) → polling UI 5 s + cron 3 min (`statusQR`) → `markPaid` idempotente → inscripción automática. Red de seguridad: "Conciliar el día" (`paidQR`). Sin credenciales: el alumno sube comprobante y el admin confirma.

## Multi-tenant
Cada academia es un tenant (`tenants`). Se resuelve por header `x-tenant` (slug), por `?t=slug` en la URL (el front lo guarda en sesión) o por dominio propio (`tenants.domain` = host). Usuarios, cursos, cobros, aulas y settings quedan aislados por tenant; el JWT lleva `tenant_id` y no sirve en otro tenant. El superadmin (`/#/superadmin`, `SUPERADMIN_TOKEN`) crea tenants, admins, entra "como admin" y atiende soporte.

## Aulas en vivo y visor de soporte
`classrooms` por curso con modo `jitsi` (aula bidireccional embebida), `youtube` (Live + chat), `cloudflare`, `meet`/`zoom`/`url`. Acceso desde 15 min antes, asistencia al entrar, grabación publicable como lección. Soporte: el admin del tenant abre una sala Jitsi con pantalla compartida + audio + chat (`support_sessions`); el superadmin entra a la misma sala como moderador.

## Transmisión propia (modo `stream`)
Instructor → OBS (RTMP/SRT/WHIP) → MediaMTX (VPS) → alumnos por WebRTC (WHEP, <1 s; audio re-codificado a Opus por un relay ffmpeg en `aulaNrtc`) con fallback HLS (~3 s). Publicar exige la clave del aula; ver exige un token de alumno firmado por el LMS (`/api/hooks/live/auth`). Estado en vivo, chat (SSE) y grabación automática publicada como lección (`/api/hooks/live/event`). Prueba local completa: `bash test/stream-e2e.sh` (necesita ffmpeg y un MediaMTX local, ver `infra/`).
