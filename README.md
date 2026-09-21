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

## Flujo de cobro
Orden → `generateQR` (monto exacto, vence mañana, singleUse) → el alumno paga desde cualquier app (QR interoperable BCB) → polling UI 5 s + cron 3 min (`statusQR`) → `markPaid` idempotente → inscripción automática. Red de seguridad: "Conciliar el día" (`paidQR`). Sin credenciales: el alumno sube comprobante y el admin confirma.
