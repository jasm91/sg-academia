// routes/admin.js — panel de administración
const express = require('express');
const crypto = require('crypto');
const { q, getSettings, setSettings } = require('../db');
const auth = require('../auth');
const payments = require('../payments');
const baneco = require('../baneco');

const router = express.Router();
router.use(auth.requireAdmin);
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'curso';

// ---------- Dashboard ----------
router.get('/dashboard', wrap(async (req, res) => {
  const one = async (sql, p) => (await q(sql, p)).rows[0];
  const stats = {
    courses: Number((await one('SELECT count(*) c FROM courses')).c),
    published: Number((await one('SELECT count(*) c FROM courses WHERE published')).c),
    students: Number((await one("SELECT count(*) c FROM users WHERE role='student'")).c),
    enrollments: Number((await one('SELECT count(*) c FROM enrollments')).c),
    certificates: Number((await one('SELECT count(*) c FROM certificates')).c),
    pending_orders: Number((await one("SELECT count(*) c FROM orders WHERE status='pending'")).c),
    revenue_month: Number((await one("SELECT coalesce(sum(amount_bs),0) s FROM orders WHERE status='paid' AND paid_at >= date_trunc('month', now())")).s),
    revenue_total: Number((await one("SELECT coalesce(sum(amount_bs),0) s FROM orders WHERE status='paid'")).s),
  };
  const recent = (await q(`SELECT o.id,o.amount_bs,o.method,o.status,o.created_at,o.paid_at,u.name,u.email,c.title
    FROM orders o JOIN users u ON u.id=o.user_id JOIN courses c ON c.id=o.course_id ORDER BY o.id DESC LIMIT 10`)).rows;
  res.json({ stats, recent, payment_mode: baneco.isConfigured() ? 'qr_baneco' : 'manual' });
}));

// ---------- Cursos ----------
router.get('/courses', wrap(async (req, res) => {
  const { rows } = await q(`SELECT c.*,
    (SELECT count(*) FROM lessons l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id) AS lessons,
    (SELECT count(*) FROM enrollments e WHERE e.course_id=c.id) AS students,
    (SELECT count(*) FROM orders o WHERE o.course_id=c.id AND o.status='paid') AS sales
    FROM courses c ORDER BY c.sort_order, c.id`);
  res.json(rows);
}));

const COURSE_FIELDS = ['title', 'subtitle', 'description', 'cover_url', 'price_bs', 'instructor', 'hours', 'published', 'passing_score', 'require_all_lessons', 'sort_order'];

router.post('/courses', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Título obligatorio' });
  let slug = slugify(b.slug || b.title);
  const dup = await q('SELECT 1 FROM courses WHERE slug=$1', [slug]);
  if (dup.rows.length) slug += '-' + crypto.randomBytes(2).toString('hex');
  const { rows } = await q(`INSERT INTO courses(slug,title,subtitle,description,cover_url,price_bs,instructor,hours,published,passing_score,require_all_lessons)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [slug, b.title, b.subtitle || null, b.description || null, b.cover_url || null, Number(b.price_bs) || 0, b.instructor || null, b.hours || null, !!b.published, Number(b.passing_score) || 70, b.require_all_lessons !== false]);
  await q("INSERT INTO quizzes(course_id,title) VALUES($1,'Examen final') ON CONFLICT DO NOTHING", [rows[0].id]);
  res.json(rows[0]);
}));

router.put('/courses/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [req.params.id];
  for (const f of COURSE_FIELDS) if (b[f] !== undefined) { vals.push(b[f] === '' ? null : b[f]); sets.push(`${f}=$${vals.length}`); }
  if (b.slug) { vals.push(slugify(b.slug)); sets.push(`slug=$${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  const { rows } = await q(`UPDATE courses SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
  res.json(rows[0]);
}));

router.delete('/courses/:id', wrap(async (req, res) => {
  await q('DELETE FROM courses WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/courses/:id/full', wrap(async (req, res) => {
  const course = (await q('SELECT * FROM courses WHERE id=$1', [req.params.id])).rows[0];
  if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
  const sections = (await q('SELECT * FROM sections WHERE course_id=$1 ORDER BY sort_order,id', [course.id])).rows;
  const lessons = (await q('SELECT l.* FROM lessons l JOIN sections s ON s.id=l.section_id WHERE s.course_id=$1 ORDER BY l.sort_order,l.id', [course.id])).rows;
  for (const s of sections) s.lessons = lessons.filter(l => l.section_id === s.id);
  let quiz = (await q('SELECT * FROM quizzes WHERE course_id=$1', [course.id])).rows[0];
  if (!quiz) quiz = (await q("INSERT INTO quizzes(course_id,title) VALUES($1,'Examen final') RETURNING *", [course.id])).rows[0];
  quiz.questions = (await q('SELECT * FROM questions WHERE quiz_id=$1 ORDER BY sort_order,id', [quiz.id])).rows;
  const students = (await q(`SELECT u.id,u.name,u.email,e.source,e.created_at,
      (SELECT count(*) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN sections s ON s.id=l.section_id WHERE s.course_id=$1 AND lp.user_id=u.id AND lp.completed) AS done,
      (SELECT code FROM certificates c WHERE c.user_id=u.id AND c.course_id=$1) AS certificate
    FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.course_id=$1 ORDER BY e.created_at DESC`, [course.id])).rows;
  res.json({ course, sections, quiz, students, total_lessons: lessons.length });
}));

// ---------- Secciones y lecciones ----------
router.post('/courses/:id/sections', wrap(async (req, res) => {
  const n = (await q('SELECT coalesce(max(sort_order),0)+1 n FROM sections WHERE course_id=$1', [req.params.id])).rows[0].n;
  const { rows } = await q('INSERT INTO sections(course_id,title,sort_order) VALUES($1,$2,$3) RETURNING *', [req.params.id, (req.body && req.body.title) || 'Nueva sección', n]);
  res.json(rows[0]);
}));
router.put('/sections/:id', wrap(async (req, res) => {
  const { rows } = await q('UPDATE sections SET title=$2 WHERE id=$1 RETURNING *', [req.params.id, req.body.title]);
  res.json(rows[0]);
}));
router.delete('/sections/:id', wrap(async (req, res) => { await q('DELETE FROM sections WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

const LESSON_FIELDS = ['title', 'kind', 'provider', 'video_ref', 'content', 'duration_min', 'is_preview'];
router.post('/sections/:id/lessons', wrap(async (req, res) => {
  const b = req.body || {};
  const n = (await q('SELECT coalesce(max(sort_order),0)+1 n FROM lessons WHERE section_id=$1', [req.params.id])).rows[0].n;
  const { rows } = await q(`INSERT INTO lessons(section_id,title,kind,provider,video_ref,content,duration_min,is_preview,sort_order)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.params.id, b.title || 'Nueva lección', b.kind || 'video', b.provider || 'youtube', b.video_ref || null, b.content || null, Number(b.duration_min) || 0, !!b.is_preview, n]);
  res.json(rows[0]);
}));
router.put('/lessons/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [req.params.id];
  for (const f of LESSON_FIELDS) if (b[f] !== undefined) { vals.push(b[f] === '' ? null : b[f]); sets.push(`${f}=$${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  const { rows } = await q(`UPDATE lessons SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
  res.json(rows[0]);
}));
router.delete('/lessons/:id', wrap(async (req, res) => { await q('DELETE FROM lessons WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

router.put('/courses/:id/reorder', wrap(async (req, res) => {
  const sections = (req.body && req.body.sections) || [];
  let si = 0;
  for (const s of sections) {
    await q('UPDATE sections SET sort_order=$2 WHERE id=$1 AND course_id=$3', [s.id, si++, req.params.id]);
    let li = 0;
    for (const lid of (s.lessons || [])) await q('UPDATE lessons SET sort_order=$2, section_id=$3 WHERE id=$1', [lid, li++, s.id]);
  }
  res.json({ ok: true });
}));

// ---------- Quiz ----------
router.put('/quizzes/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const { rows } = await q('UPDATE quizzes SET title=coalesce($2,title), max_attempts=coalesce($3,max_attempts), time_limit_min=coalesce($4,time_limit_min), shuffle=coalesce($5,shuffle) WHERE id=$1 RETURNING *',
    [req.params.id, b.title, b.max_attempts, b.time_limit_min, b.shuffle]);
  res.json(rows[0]);
}));
router.post('/quizzes/:id/questions', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.text) return res.status(400).json({ error: 'Texto de la pregunta obligatorio' });
  const n = (await q('SELECT coalesce(max(sort_order),0)+1 n FROM questions WHERE quiz_id=$1', [req.params.id])).rows[0].n;
  const options = b.kind === 'truefalse' ? ['Verdadero', 'Falso'] : (b.options || []);
  const { rows } = await q('INSERT INTO questions(quiz_id,text,kind,options,correct,explanation,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.params.id, b.text, b.kind || 'single', JSON.stringify(options), JSON.stringify(b.correct || []), b.explanation || null, n]);
  res.json(rows[0]);
}));
router.put('/questions/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const options = b.kind === 'truefalse' ? ['Verdadero', 'Falso'] : b.options;
  const { rows } = await q(`UPDATE questions SET text=coalesce($2,text), kind=coalesce($3,kind), options=coalesce($4,options), correct=coalesce($5,correct), explanation=$6 WHERE id=$1 RETURNING *`,
    [req.params.id, b.text, b.kind, options ? JSON.stringify(options) : null, b.correct ? JSON.stringify(b.correct) : null, b.explanation || null]);
  res.json(rows[0]);
}));
router.delete('/questions/:id', wrap(async (req, res) => { await q('DELETE FROM questions WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// ---------- Órdenes / cobros ----------
router.get('/orders', wrap(async (req, res) => {
  const st = req.query.status;
  const { rows } = await q(`SELECT o.id,o.amount_bs,o.method,o.status,o.qr_id,o.qr_due_date,o.created_at,o.paid_at,o.paid_by,o.receipt_note,(o.receipt IS NOT NULL) AS has_receipt,
      u.id AS user_id,u.name,u.email,u.phone,c.title,c.id AS course_id
    FROM orders o JOIN users u ON u.id=o.user_id JOIN courses c ON c.id=o.course_id
    ${st ? 'WHERE o.status=$1' : ''} ORDER BY o.id DESC LIMIT 300`, st ? [st] : []);
  res.json(rows);
}));
router.post('/orders/:id/mark-paid', wrap(async (req, res) => {
  const o = await payments.markPaid(req.params.id, 'admin', { by: req.user.email, note: (req.body && req.body.note) || null });
  if (!o) return res.status(400).json({ error: 'La orden no estaba pendiente' });
  res.json(o);
}));
router.post('/orders/:id/cancel', wrap(async (req, res) => {
  const o = (await q("SELECT * FROM orders WHERE id=$1 AND status='pending'", [req.params.id])).rows[0];
  if (!o) return res.status(400).json({ error: 'La orden no estaba pendiente' });
  if (o.qr_id) { try { await baneco.cancelQR(o.qr_id); } catch (_) { /* ambiguo */ } }
  await q("UPDATE orders SET status='cancelled' WHERE id=$1", [o.id]);
  res.json({ ok: true });
}));
router.post('/orders/:id/check', wrap(async (req, res) => {
  const o = (await q('SELECT * FROM orders WHERE id=$1', [req.params.id])).rows[0];
  if (!o) return res.status(404).json({ error: 'No existe' });
  res.json(await payments.checkOrder(o));
}));
router.get('/orders/:id/receipt', wrap(async (req, res) => {
  const o = (await q('SELECT receipt,receipt_mime FROM orders WHERE id=$1', [req.params.id])).rows[0];
  if (!o || !o.receipt) return res.status(404).json({ error: 'Sin comprobante' });
  res.setHeader('Content-Type', o.receipt_mime);
  res.send(o.receipt);
}));

// ---------- Alumnos ----------
router.get('/students', wrap(async (req, res) => {
  const { rows } = await q(`SELECT u.id,u.name,u.email,u.phone,u.role,u.created_at,
      (SELECT count(*) FROM enrollments e WHERE e.user_id=u.id) AS enrollments,
      (SELECT count(*) FROM certificates c WHERE c.user_id=u.id) AS certificates
    FROM users u ORDER BY u.id DESC LIMIT 500`);
  res.json(rows);
}));
router.post('/students', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.name) return res.status(400).json({ error: 'Nombre y email obligatorios' });
  const pw = b.password || crypto.randomBytes(4).toString('hex');
  const { rows } = await q('INSERT INTO users(email,password_hash,name,phone,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id,email,name,role',
    [String(b.email).toLowerCase().trim(), await auth.hash(pw), b.name, b.phone || null, b.role === 'admin' ? 'admin' : 'student']);
  res.json({ user: rows[0], password: b.password ? undefined : pw });
}));
router.put('/students/:id', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.password) await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.params.id, await auth.hash(b.password)]);
  if (b.role) await q('UPDATE users SET role=$2 WHERE id=$1', [req.params.id, b.role === 'admin' ? 'admin' : 'student']);
  if (b.name) await q('UPDATE users SET name=$2 WHERE id=$1', [req.params.id, b.name]);
  res.json({ ok: true });
}));
router.post('/students/:id/enroll', wrap(async (req, res) => {
  await payments.enroll(req.params.id, req.body.course_id, 'admin');
  res.json({ ok: true });
}));
router.delete('/students/:id/enroll/:courseId', wrap(async (req, res) => {
  await q('DELETE FROM enrollments WHERE user_id=$1 AND course_id=$2', [req.params.id, req.params.courseId]);
  res.json({ ok: true });
}));

// ---------- Certificados ----------
router.get('/certificates', wrap(async (req, res) => {
  const { rows } = await q('SELECT c.code,c.score,c.issued_at,u.name,u.email,co.title FROM certificates c JOIN users u ON u.id=c.user_id JOIN courses co ON co.id=c.course_id ORDER BY c.issued_at DESC LIMIT 500');
  res.json(rows);
}));

// ---------- Configuración ----------
router.get('/settings', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({ settings: s, baneco: { configured: baneco.isConfigured(), base: process.env.BANECO_BASE_URL || 'https://apimkt.baneco.com.bo/ApiGateway/' }, bunny: { configured: !!(process.env.BUNNY_LIBRARY_ID && process.env.BUNNY_API_KEY), library: process.env.BUNNY_LIBRARY_ID || null, token_auth: !!process.env.BUNNY_TOKEN_KEY } });
}));
router.put('/settings', wrap(async (req, res) => { await setSettings(req.body || {}); res.json(await getSettings()); }));

router.get('/baneco/health', wrap(async (req, res) => res.json(await baneco.health())));
router.post('/baneco/poll', wrap(async (req, res) => res.json(await payments.pollPending())));
router.post('/baneco/reconcile', wrap(async (req, res) => {
  const d = (req.body && req.body.date) || payments.todayBolivia();
  res.json(await payments.reconcileDay(String(d).replace(/-/g, '')));
}));

// ---------- Bunny Stream (subida directa desde el navegador con firma TUS) ----------
function bunnyCfg() { return { lib: process.env.BUNNY_LIBRARY_ID, key: process.env.BUNNY_API_KEY }; }
router.get('/bunny/videos', wrap(async (req, res) => {
  const { lib, key } = bunnyCfg();
  if (!lib || !key) return res.status(400).json({ error: 'Bunny no configurado (BUNNY_LIBRARY_ID / BUNNY_API_KEY)' });
  const r = await fetch(`https://video.bunnycdn.com/library/${lib}/videos?page=1&itemsPerPage=100&orderBy=date`, { headers: { AccessKey: key, accept: 'application/json' } });
  const j = await r.json();
  res.json((j.items || []).map(v => ({ guid: v.guid, title: v.title, length: v.length, status: v.status, encodeProgress: v.encodeProgress })));
}));
router.post('/bunny/videos', wrap(async (req, res) => {
  const { lib, key } = bunnyCfg();
  if (!lib || !key) return res.status(400).json({ error: 'Bunny no configurado' });
  const r = await fetch(`https://video.bunnycdn.com/library/${lib}/videos`, { method: 'POST', headers: { AccessKey: key, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ title: (req.body && req.body.title) || 'video' }) });
  const v = await r.json();
  if (!v.guid) return res.status(500).json({ error: 'Bunny no devolvió guid', detail: v });
  const expiration = Math.floor(Date.now() / 1000) + 6 * 3600;
  const signature = crypto.createHash('sha256').update(lib + key + expiration + v.guid).digest('hex');
  res.json({ guid: v.guid, library: lib, expiration, signature, endpoint: 'https://video.bunnycdn.com/tusupload' });
}));

module.exports = router;
