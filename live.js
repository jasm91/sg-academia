// live.js — aulas en vivo y soporte: arma el payload de acceso según el modo.
// Modos de aula: jitsi (Jitsi PROPIO en JITSI_DOMAIN con JWT > JaaS/8x8 > meet.jit.si público),
// stream (transmisión PROPIA: MediaMTX en LIVE_DOMAIN, ingesta RTMP/SRT/WHIP, reproducción WebRTC/HLS),
// youtube (Live embebido + chat), cloudflare (Stream Live), meet | zoom | url (link externo).
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const bus = new EventEmitter(); bus.setMaxListeners(0); // pub/sub in-process para chat y estado de aulas

// ---------- Jitsi ----------
const SELF = () => ({ domain: process.env.JITSI_DOMAIN || '', appId: process.env.JITSI_APP_ID || '', secret: process.env.JITSI_APP_SECRET || '' });
const JAAS = () => ({ appId: process.env.JAAS_APP_ID || '', kid: process.env.JAAS_KEY_ID || '', key: (process.env.JAAS_PRIVATE_KEY || '').replace(/\\n/g, '\n') });
const selfReady = () => { const s = SELF(); return !!(s.domain && s.appId && s.secret); };
const jaasReady = () => { const j = JAAS(); return !!(j.appId && j.kid && j.key); };
function jitsiProvider() { return selfReady() ? 'self' : jaasReady() ? 'jaas' : 'public'; }

function roomName(classroom) {
  return classroom.room_name || `sga-${classroom.course_id}-${classroom.id}-${crypto.randomBytes(3).toString('hex')}`;
}

// JWT para Jitsi propio (prosody token auth, HS256). Solo lo reciben los moderadores; los demás entran como invitados.
function selfToken(user, room, moderator) {
  const s = SELF();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: s.appId, aud: s.appId, sub: s.domain, room,
    exp: now + 6 * 3600, nbf: now - 10,
    context: { user: { id: String(user.id), name: user.name, email: user.email, moderator: moderator ? 'true' : 'false', affiliation: moderator ? 'owner' : 'member' } },
  }, s.secret, { algorithm: 'HS256' });
}

function jaasToken(user, room, moderator) {
  const j = JAAS();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    aud: 'jitsi', iss: 'chat', sub: j.appId, room, exp: now + 4 * 3600, nbf: now - 10,
    context: {
      user: { id: String(user.id), name: user.name, email: user.email, moderator: moderator ? 'true' : 'false' },
      features: { livestreaming: 'false', recording: moderator ? 'true' : 'false', transcription: 'false', 'outbound-call': 'false' },
    },
  }, j.key, { algorithm: 'RS256', header: { kid: j.kid, typ: 'JWT' } });
}

function jitsiPayload(base, room, user, isModerator) {
  const p = jitsiProvider();
  if (p === 'self') {
    const s = SELF();
    return { ...base, provider: 'self', domain: s.domain, room, jwt: isModerator ? selfToken(user, room, true) : undefined, script: `https://${s.domain}/external_api.js`,
      note: isModerator ? null : 'La sala se abre cuando entra el instructor.' };
  }
  if (p === 'jaas') {
    const j = JAAS();
    return { ...base, provider: 'jaas', domain: '8x8.vc', room: `${j.appId}/${room}`, jwt: jaasToken(user, room, isModerator), script: `https://8x8.vc/${j.appId}/external_api.js` };
  }
  return { ...base, provider: 'jitsi', domain: 'meet.jit.si', room, script: 'https://meet.jit.si/external_api.js', note: isModerator ? 'En meet.jit.si el instructor debe iniciar sesión (Google/GitHub) como moderador la primera vez.' : null };
}

// ---------- Transmisión propia (MediaMTX) ----------
const LIVE = () => ({ domain: process.env.LIVE_DOMAIN || '', scheme: process.env.LIVE_SCHEME || 'https', secret: process.env.LIVE_SECRET || '', rtmpHost: process.env.LIVE_RTMP_HOST || process.env.LIVE_DOMAIN || '', rtmpPort: process.env.LIVE_RTMP_PORT || '1935', srtPort: process.env.LIVE_SRT_PORT || '', turn: process.env.LIVE_TURN_URL ? [{ urls: process.env.LIVE_TURN_URL, username: process.env.LIVE_TURN_USER || 'sga', credential: process.env.LIVE_TURN_PASS || process.env.LIVE_SECRET }] : [] });
const streamReady = () => { const l = LIVE(); return !!(l.domain && l.secret); };
const streamPath = c => `aula${c.id}`;
const newStreamKey = () => crypto.randomBytes(12).toString('base64url');

function readerToken(user, path) {
  const l = LIVE();
  return jwt.sign({ sub: String(user.id), name: user.name, path, kind: 'read' }, l.secret, { algorithm: 'HS256', expiresIn: '8h' });
}
function verifyReaderToken(token, path) {
  try { const d = jwt.verify(token, LIVE().secret, { algorithms: ['HS256'] }); return d.kind === 'read' && (d.path === path || d.path === '*'); }
  catch (_) { return false; }
}

function streamPayload(base, c, user, isModerator) {
  const l = LIVE();
  const path = streamPath(c);
  const dom = l.domain;
  const tok = readerToken(user, path);
  const out = { ...base, provider: 'mediamtx', path,
    whep: `${l.scheme}://${dom}/${path}rtc/whep?jwt=${tok}`,
    hls: `${l.scheme}://${dom}/${path}/index.m3u8?jwt=${tok}`,
    hls_query: `jwt=${tok}`,
    ice: [{ urls: 'stun:stun.l.google.com:19302' }, ...l.turn],
    chat: true, configured: streamReady() };
  if (isModerator) {
    out.publish = {
      rtmp_server: `rtmp://${l.rtmpHost}:${l.rtmpPort}/${path}`,
      rtmp_key: `?user=obs&pass=${c.stream_key}`,
      rtmp_full: `rtmp://${l.rtmpHost}:${l.rtmpPort}/${path}?user=obs&pass=${c.stream_key}`,
      srt: l.srtPort ? `srt://${l.rtmpHost}:${l.srtPort}?streamid=publish:${path}:obs:${c.stream_key}` : null,
      whip: `${l.scheme}://${dom}/${path}/whip?user=obs&pass=${c.stream_key}`,
    };
  }
  if (!streamReady()) out.note = 'Falta configurar LIVE_DOMAIN y LIVE_SECRET (servidor de transmisión propio).';
  return out;
}

// Respuesta al callback de autenticación de MediaMTX (authMethod: http)
// body: { ip, user, password, token, action, path, protocol, id, query, userAgent }
async function authorizeMediaMtx(body, findClassroomByPath) {
  const { action, path } = body;
  if (['api', 'metrics', 'pprof'].includes(action)) return /^(127\.0\.0\.1|::1|172\.|10\.)/.test(body.ip || '');
  const m = /^aula(\d+)(rtc)?$/.exec(path || '');
  if (!m) return false;
  const basePath = `aula${m[1]}`, isRelay = !!m[2];
  const c = await findClassroomByPath(Number(m[1]));
  if (!c || c.mode !== 'stream' || c.status === 'cancelled') return false;
  const q = new URLSearchParams(body.query || '');
  if (action === 'publish') {
    const pass = body.password || q.get('pass') || q.get('key') || '';
    if (isRelay) return (body.user === 'relay') && pass === LIVE().secret; // ffmpeg local (relay Opus)
    return !!c.stream_key && pass === c.stream_key;
  }
  if (action === 'read' || action === 'playback') {
    const tok = body.token || q.get('jwt') || '';
    if (body.user === 'relay' && (body.password || '') === LIVE().secret && /^(127\.0\.0\.1|::1|172\.|10\.)/.test(body.ip || '')) return true; // relay local lee el aula base
    return verifyReaderToken(tok, basePath);
  }
  return false;
}

// ---------- Ventana de acceso ----------
function window(c) {
  const start = new Date(c.starts_at).getTime();
  const end = start + (c.duration_min || 60) * 60000;
  const now = Date.now();
  return {
    opensAt: new Date(start - 15 * 60000), endsAt: new Date(end),
    canJoin: c.status === 'live' || (c.status === 'scheduled' && now >= start - 15 * 60000 && now <= end + 30 * 60000),
    isPast: c.status === 'ended' || c.status === 'cancelled' || now > end + 30 * 60000,
  };
}

function youtubeId(ref) {
  const m = String(ref || '').match(/(?:v=|youtu\.be\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : String(ref || '').trim();
}

/** @returns objeto listo para el front */
function joinPayload(c, user, isAdmin, host) {
  const base = { mode: c.mode, title: c.title, moderator: !!isAdmin };
  switch (c.mode) {
    case 'jitsi': return jitsiPayload(base, c.room_name, user, isAdmin);
    case 'stream': return streamPayload(base, c, user, isAdmin);
    case 'youtube': {
      const id = youtubeId(c.join_ref);
      return { ...base, video: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`, chat: host ? `https://www.youtube.com/live_chat?v=${id}&embed_domain=${host}` : null };
    }
    case 'cloudflare': {
      const code = process.env.CF_STREAM_CUSTOMER_CODE;
      const ref = String(c.join_ref || '');
      const src = /^https?:/.test(ref) ? ref : (code ? `https://customer-${code}.cloudflarestream.com/${ref}/iframe?autoplay=true` : null);
      return { ...base, video: src, note: src ? null : 'Falta CF_STREAM_CUSTOMER_CODE o la URL del reproductor.' };
    }
    default:
      return { ...base, url: c.join_ref };
  }
}

module.exports = { bus, roomName, joinPayload, window, jaasReady, selfReady, jitsiProvider, streamReady, streamPath, newStreamKey, readerToken, verifyReaderToken, authorizeMediaMtx, youtubeId, LIVE };
