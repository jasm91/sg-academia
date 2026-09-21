# Servidor de medios propio (VPS)

Un solo VPS (2 vCPU / 4 GB, Ubuntu 22.04+, IP pública) corre:

| Servicio | Para qué | Puertos |
|---|---|---|
| **Jitsi Meet** (web, prosody, jicofo, jvb) | Aulas virtuales y visor de soporte, con JWT firmado por la app | 443 (Caddy), 10000/udp |
| **MediaMTX** | "YouTube Live propio": ingesta RTMP/SRT/WHIP desde OBS, salida WebRTC (<1 s) y HLS, grabación automática | 1935, 8890/udp, 8189 |
| **Caddy** | TLS automático (Let's Encrypt) y proxy para `meet.` y `live.` | 80, 443 |

## Pasos
1. DNS: registros **A** de `meet.tudominio` y `live.tudominio` → IP del VPS (en la zona Cloudflare del proyecto, **sin proxy naranja**: WebRTC/RTMP no pasan por Cloudflare).
2. En el VPS: `git clone https://github.com/jasm91/sg-academia && cd sg-academia/infra && cp .env.example .env && nano .env` (dominios, `LMS_URL`, `LIVE_SECRET`, `JITSI_APP_ID/SECRET`).
3. `sudo ./install.sh` (instala Docker, abre firewall, levanta todo).
4. En Railway → `academia-app` → variables: `JITSI_DOMAIN`, `JITSI_APP_ID`, `JITSI_APP_SECRET`, `LIVE_DOMAIN`, `LIVE_SECRET` (mismos valores que `.env`). El servicio se redeploya y el panel muestra "Jitsi propio" y "Transmisión propia".

## Cómo fluye
- **Aula virtual**: el instructor/superadmin recibe un JWT (moderador); los alumnos entran como invitados y esperan en el lobby hasta que entra el moderador.
- **Transmisión**: el admin programa un aula en modo *Transmisión propia*, copia servidor + clave a OBS. MediaMTX consulta a la app (`/api/hooks/live/auth`) para autorizar publicar (clave del aula) y ver (token del alumno). Al conectar OBS, `runOnReady` avisa a la app → el aula pasa a "En vivo" y el chat lo anuncia. Al cortar, la grabación (`/recordings/aulaN/*.mp4`) queda servida en `https://live.tudominio/rec/...` y la app la publica como lección.
- **Capacidad**: ~2 Mbps por espectador de WebRTC/HLS. 100 alumnos × 2 h ≈ 180 GB por clase. Para audiencias grandes, poner Bunny CDN (pull zone) delante de `/aulaN/index.m3u8`.

## Operación
- Logs: `docker compose logs -f mediamtx` / `docker compose logs -f jvb`
- Actualizar: `docker compose pull && docker compose up -d`
- Grabaciones viejas: se borran a los 30 días (`recordDeleteAfter`); antes de eso subilas a Bunny desde el panel (o mantené el `/rec/` como VOD si el disco alcanza).
