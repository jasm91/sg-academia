// video.js — construye la URL de embed según proveedor. Bunny Stream con token de embed firmado.
const crypto = require('crypto');

function bunnyEmbed(videoId) {
  const lib = process.env.BUNNY_LIBRARY_ID;
  const key = process.env.BUNNY_TOKEN_KEY; // "Embed View Token Authentication Key" de la biblioteca
  if (!lib) return null;
  let url = `https://iframe.mediadelivery.net/embed/${lib}/${videoId}?autoplay=false&preload=true`;
  if (key) {
    const expires = Math.floor(Date.now() / 1000) + 6 * 3600; // 6 horas
    const token = crypto.createHash('sha256').update(key + videoId + expires).digest('hex');
    url += `&token=${token}&expires=${expires}`;
  }
  return url;
}

function youtubeId(ref) {
  const m = String(ref).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : String(ref).trim();
}

function vimeoId(ref) {
  const m = String(ref).match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : String(ref).trim();
}

/** @returns {{type:'iframe'|'video'|null, src:string|null}} */
function embedFor(lesson) {
  if (!lesson || !lesson.video_ref) return { type: null, src: null };
  const ref = lesson.video_ref;
  switch (lesson.provider) {
    case 'bunny': return { type: 'iframe', src: bunnyEmbed(ref) };
    case 'youtube': return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${youtubeId(ref)}?rel=0&modestbranding=1` };
    case 'vimeo': return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeoId(ref)}?dnt=1` };
    case 'url': return { type: 'video', src: ref };
    default: return { type: null, src: null };
  }
}

module.exports = { embedFor };
