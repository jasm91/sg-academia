// live.js — aulas en vivo: arma el payload de acceso según el modo del aula.
// Modos: jitsi (meet.jit.si público o JaaS/8x8 con JWT si hay env), youtube (Live embebido + chat),
// cloudflare (Stream Live embebido), meet | zoom | url (link externo).
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JAAS = () => ({
  appId: process.env.JAAS_APP_ID || '',
  kid: process.env.JAAS_KEY_ID || '',
  key: (process.env.JAAS_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
});
const jaasReady = () => { const j = JAAS(); return !!(j.appId && j.kid && j.key); };

function roomName(classroom) {
  return classroom.room_name || `sga-${classroom.course_id}-${classroom.id}-${crypto.randomBytes(3).toString('hex')}`;
}

function jaasToken(user, room, moderator) {
  const j = JAAS();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    aud: 'jitsi', iss: 'chat', sub: j.appId, room,
    exp: now + 4 * 3600, nbf: now - 10,
    context: {
      user: { id: String(user.id), name: user.name, email: user.email, moderator: moderator ? 'true' : 'false' },
      features: { livestreaming: 'false', recording: moderator ? 'true' : 'false', transcription: 'false', 'outbound-call': 'false' },
    },
  }, j.key, { algorithm: 'RS256', header: { kid: j.kid, typ: 'JWT' } });
}

function youtubeId(ref) {
  const m = String(ref || '').match(/(?:v=|youtu\.be\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : String(ref || '').trim();
}

/** Ventana de acceso: desde 15 min antes hasta 30 min después del fin (o mientras status=live) */
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

/** @returns objeto listo para el front: {mode, embed:{...}} */
function joinPayload(c, user, isAdmin, host) {
  const base = { mode: c.mode, title: c.title, moderator: !!isAdmin };
  switch (c.mode) {
    case 'jitsi': {
      const room = c.room_name;
      if (jaasReady()) {
        const j = JAAS();
        return { ...base, provider: 'jaas', domain: '8x8.vc', room: `${j.appId}/${room}`, jwt: jaasToken(user, room, isAdmin), script: `https://8x8.vc/${j.appId}/external_api.js` };
      }
      return { ...base, provider: 'jitsi', domain: 'meet.jit.si', room, script: 'https://meet.jit.si/external_api.js', note: isAdmin ? 'En meet.jit.si el instructor debe iniciar sesión (Google/GitHub) como moderador la primera vez.' : null };
    }
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

module.exports = { roomName, joinPayload, window, jaasReady, youtubeId };
