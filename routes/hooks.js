// routes/hooks.js — callbacks del servidor de medios propio (MediaMTX): autenticación y eventos.
const express = require('express');
const { q } = require('../db');
const live = require('../live');

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const findClassroom = async id => (await q('SELECT * FROM classrooms WHERE id=$1', [id])).rows[0] || null;

// MediaMTX -> authHTTPAddress. 200 = permitido, 401 = denegado.
router.post('/live/auth', wrap(async (req, res) => {
  if (!live.streamReady()) return res.status(401).json({ error: 'stream no configurado' });
  const ok = await live.authorizeMediaMtx(req.body || {}, findClassroom);
  if (!ok) return res.status(401).json({ error: 'denegado' });
  res.json({ ok: true });
}));

// MediaMTX runOnReady / runOnNotReady / runOnRecordSegmentComplete -> eventos de la transmisión.
// header x-live-secret = LIVE_SECRET. body: { event: 'ready'|'notready'|'segment', path, file, url }
router.post('/live/event', wrap(async (req, res) => {
  const l = live.LIVE();
  if (!l.secret || req.headers['x-live-secret'] !== l.secret) return res.status(401).json({ error: 'secret' });
  const b = req.body || {};
  const m = /^aula(\d+)$/.exec(b.path || '');
  if (!m) return res.json({ ignored: true });
  const c = await findClassroom(Number(m[1]));
  if (!c) return res.json({ ignored: true });
  if (b.event === 'ready') {
    await q("UPDATE classrooms SET status='live' WHERE id=$1 AND status IN ('scheduled','live')", [c.id]);
    live.bus.emit(`aula:${c.id}`, { type: 'status', status: 'live' });
  } else if (b.event === 'notready') {
    // El instructor cortó: el aula queda 'ended' solo si ya pasó la hora de fin, si no vuelve a 'scheduled' (reconexión)
    const w = live.window({ ...c, status: 'scheduled' });
    const st = Date.now() > new Date(w.endsAt).getTime() ? 'ended' : 'scheduled';
    await q("UPDATE classrooms SET status=$2 WHERE id=$1 AND status='live'", [c.id, st]);
    live.bus.emit(`aula:${c.id}`, { type: 'status', status: st });
  } else if (b.event === 'segment' && b.url) {
    // Grabación lista: se publica como lección (sección "Grabaciones de aulas") si no había una
    await q('UPDATE classrooms SET recording_url=$2 WHERE id=$1', [c.id, b.url]);
    if (!c.recording_lesson_id) {
      let sec = (await q("SELECT id FROM sections WHERE course_id=$1 AND title='Grabaciones de aulas' LIMIT 1", [c.course_id])).rows[0];
      if (!sec) sec = (await q("INSERT INTO sections(course_id,title,sort_order) VALUES($1,'Grabaciones de aulas',999) RETURNING id", [c.course_id])).rows[0];
      const n = (await q('SELECT coalesce(max(sort_order),0)+1 n FROM lessons WHERE section_id=$1', [sec.id])).rows[0].n;
      const les = (await q("INSERT INTO lessons(section_id,title,kind,provider,video_ref,duration_min,sort_order) VALUES($1,$2,'video','url',$3,$4,$5) RETURNING id",
        [sec.id, `Grabación · ${c.title}`, b.url, c.duration_min, n])).rows[0];
      await q('UPDATE classrooms SET recording_lesson_id=$2 WHERE id=$1', [c.id, les.id]);
    } else {
      await q('UPDATE lessons SET video_ref=$2, provider=$3 WHERE id=$1', [c.recording_lesson_id, b.url, 'url']);
    }
  }
  res.json({ ok: true });
}));

module.exports = router;
