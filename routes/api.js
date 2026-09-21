// routes/api.js — API pública + alumno
const express = require('express');
const multer = require('multer');
const { q, getSettings } = require('../db');
const auth = require('../auth');
const { embedFor } = require('../video');
const payments = require('../payments');
const certs = require('../certificates');
const baneco = require('../baneco');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

function baseUrl(req) {
  return process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
}

// ---------- Config pública ----------
router.get('/config', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({
    brand_name: s.brand_name, brand_tagline: s.brand_tagline, currency: s.currency,
    support_whatsapp: s.support_whatsapp,
    payment_mode: baneco.isConfigured() ? 'qr_baneco' : 'manual',
    manual_instructions: s.manual_instructions,
    manual_qr_image: s.manual_qr_image,
    version: require('../package.json').version,
  });
}));

// ---------- Auth ----------
router.post('/auth/register', wrap(async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const em = String(email).trim().toLowerCase();
  const dup = await q('SELECT id FROM users WHERE email=$1', [em]);
  if (dup.rows.length) return res.status(409).json({ error: 'Ese email ya está registrado' });
  const { rows } = await q('INSERT INTO users(email,password_hash,name,phone) VALUES($1,$2,$3,$4) RETURNING id,email,name,role,phone',
    [em, await auth.hash(password), String(name).trim(), phone || null]);
  res.json({ token: auth.sign(rows[0]), user: rows[0] });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await q('SELECT * FROM users WHERE email=$1', [String(email || '').trim().toLowerCase()]);
  const u = rows[0];
  if (!u || !(await auth.verify(String(password || ''), u.password_hash))) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  res.json({ token: auth.sign(u), user: { id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone } });
}));

router.get('/me', auth.requireAuth, wrap(async (req, res) => {
  const u = (await q('SELECT id,email,name,role,phone,created_at FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!u) return res.status(401).json({ error: 'Usuario no existe' });
  const enrollments = (await q(`
    SELECT e.course_id, e.created_at, c.slug, c.title, c.cover_url, c.subtitle,
      (SELECT count(*) FROM lessons l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id) AS total_lessons,
      (SELECT count(*) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id AND lp.user_id=e.user_id AND lp.completed) AS done_lessons,
      (SELECT code FROM certificates ce WHERE ce.user_id=e.user_id AND ce.course_id=c.id) AS certificate_code
    FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=$1 ORDER BY e.created_at DESC`, [u.id])).rows;
  const orders = (await q("SELECT o.id,o.course_id,o.amount_bs,o.method,o.status,o.created_at,c.title,c.slug FROM orders o JOIN courses c ON c.id=o.course_id WHERE o.user_id=$1 AND o.status='pending' ORDER BY o.id DESC", [u.id])).rows;
  res.json({ user: u, enrollments, pending_orders: orders });
}));

router.put('/me', auth.requireAuth, wrap(async (req, res) => {
  const { name, phone, password } = req.body || {};
  if (name) await q('UPDATE users SET name=$2 WHERE id=$1', [req.user.id, String(name).trim()]);
  if (phone !== undefined) await q('UPDATE users SET phone=$2 WHERE id=$1', [req.user.id, phone || null]);
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Contraseña muy corta' });
    await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await auth.hash(password)]);
  }
  const u = (await q('SELECT id,email,name,role,phone FROM users WHERE id=$1', [req.user.id])).rows[0];
  res.json({ user: u, token: auth.sign(u) });
}));

// ---------- Catálogo ----------
router.get('/courses', wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT c.id,c.slug,c.title,c.subtitle,c.cover_url,c.price_bs,c.instructor,c.hours,
      (SELECT count(*) FROM lessons l JOIN sections s ON s.id=l.section_id WHERE s.course_id=c.id) AS lessons,
      (SELECT count(*) FROM enrollments e WHERE e.course_id=c.id) AS students
    FROM courses c WHERE c.published ORDER BY c.sort_order, c.id`);
  res.json(rows);
}));

async function loadCourse(slug) {
  const { rows } = await q('SELECT * FROM courses WHERE slug=$1', [slug]);
  return rows[0] || null;
}

async function isEnrolled(userId, courseId) {
  if (!userId) return false;
  const { rows } = await q('SELECT 1 FROM enrollments WHERE user_id=$1 AND course_id=$2', [userId, courseId]);
  return rows.length > 0;
}

async function curriculum(courseId, userId) {
  const sections = (await q('SELECT id,title,sort_order FROM sections WHERE course_id=$1 ORDER BY sort_order,id', [courseId])).rows;
  const lessons = (await q(`
    SELECT l.id,l.section_id,l.title,l.kind,l.duration_min,l.is_preview,l.sort_order,
      COALESCE(lp.completed,false) AS completed
    FROM lessons l JOIN sections s ON s.id=l.section_id
    LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$2
    WHERE s.course_id=$1 ORDER BY s.sort_order,s.id,l.sort_order,l.id`, [courseId, userId || 0])).rows;
  for (const s of sections) s.lessons = lessons.filter(l => l.section_id === s.id);
  return { sections, total: lessons.length, done: lessons.filter(l => l.completed).length };
}

router.get('/courses/:slug', auth.optionalAuth, wrap(async (req, res) => {
  const c = await loadCourse(req.params.slug);
  if (!c || (!c.published && (!req.user || req.user.role !== 'admin'))) return res.status(404).json({ error: 'Curso no encontrado' });
  const uid = req.user && req.user.id;
  const enrolled = uid ? (req.user.role === 'admin' || await isEnrolled(uid, c.id)) : false;
  const cur = await curriculum(c.id, uid);
  const quiz = (await q('SELECT id,title,max_attempts,time_limit_min,(SELECT count(*) FROM questions WHERE quiz_id=quizzes.id) AS questions FROM quizzes WHERE course_id=$1', [c.id])).rows[0] || null;
  let certificate = null, attempts = [];
  if (uid) {
    certificate = (await q('SELECT code,score,issued_at FROM certificates WHERE user_id=$1 AND course_id=$2', [uid, c.id])).rows[0] || null;
    if (quiz) attempts = (await q('SELECT id,score,passed,created_at FROM quiz_attempts WHERE user_id=$1 AND quiz_id=$2 ORDER BY id', [uid, quiz.id])).rows;
  }
  const pending_order = uid ? (await q("SELECT id,method,status,amount_bs FROM orders WHERE user_id=$1 AND course_id=$2 AND status='pending' ORDER BY id DESC LIMIT 1", [uid, c.id])).rows[0] || null : null;
  const { qr_image, ...course } = c;
  res.json({ course, enrolled, curriculum: cur, quiz, attempts, certificate, pending_order });
}));

// ---------- Lecciones ----------
router.get('/lessons/:id', auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await q(`SELECT l.*, s.course_id, s.title AS section_title, c.slug, c.title AS course_title
    FROM lessons l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE l.id=$1`, [req.params.id]);
  const l = rows[0];
  if (!l) return res.status(404).json({ error: 'Lección no encontrada' });
  const ok = req.user.role === 'admin' || l.is_preview || await isEnrolled(req.user.id, l.course_id);
  if (!ok) return res.status(403).json({ error: 'Necesitás inscribirte para ver esta lección' });
  const prog = (await q('SELECT completed,seconds FROM lesson_progress WHERE user_id=$1 AND lesson_id=$2', [req.user.id, l.id])).rows[0] || { completed: false, seconds: 0 };
  // siguiente / anterior
  const all = (await q(`SELECT l.id FROM lessons l JOIN sections s ON s.id=l.section_id WHERE s.course_id=$1 ORDER BY s.sort_order,s.id,l.sort_order,l.id`, [l.course_id])).rows.map(r => r.id);
  const i = all.indexOf(l.id);
  const { video_ref, ...lesson } = l;
  res.json({ lesson, embed: embedFor(l), progress: prog, prev: i > 0 ? all[i - 1] : null, next: i < all.length - 1 ? all[i + 1] : null });
}));

router.post('/lessons/:id/progress', auth.requireAuth, wrap(async (req, res) => {
  const { completed, seconds } = req.body || {};
  await q(`INSERT INTO lesson_progress(user_id,lesson_id,completed,seconds,updated_at) VALUES($1,$2,$3,$4,now())
    ON CONFLICT (user_id,lesson_id) DO UPDATE SET completed = lesson_progress.completed OR EXCLUDED.completed, seconds=GREATEST(lesson_progress.seconds, EXCLUDED.seconds), updated_at=now()`,
    [req.user.id, req.params.id, !!completed, Number(seconds) || 0]);
  res.json({ ok: true });
}));

// ---------- Quiz ----------
async function quizAccess(req, res) {
  const c = await loadCourse(req.params.slug);
  if (!c) { res.status(404).json({ error: 'Curso no encontrado' }); return null; }
  if (req.user.role !== 'admin' && !(await isEnrolled(req.user.id, c.id))) { res.status(403).json({ error: 'No estás inscripto' }); return null; }
  const quiz = (await q('SELECT * FROM quizzes WHERE course_id=$1', [c.id])).rows[0];
  if (!quiz) { res.status(404).json({ error: 'Este curso no tiene examen' }); return null; }
  return { course: c, quiz };
}

router.get('/courses/:slug/quiz', auth.requireAuth, wrap(async (req, res) => {
  const a = await quizAccess(req, res); if (!a) return;
  const { course, quiz } = a;
  const cur = await curriculum(course.id, req.user.id);
  if (course.require_all_lessons && cur.done < cur.total && req.user.role !== 'admin') {
    return res.status(403).json({ error: `Completá todas las lecciones antes del examen (${cur.done}/${cur.total})`, locked: true });
  }
  const attempts = (await q('SELECT id,score,passed,created_at FROM quiz_attempts WHERE user_id=$1 AND quiz_id=$2 ORDER BY id', [req.user.id, quiz.id])).rows;
  if (attempts.some(x => x.passed)) return res.json({ quiz: { id: quiz.id, title: quiz.title }, attempts, already_passed: true, questions: [] });
  if (attempts.length >= quiz.max_attempts) return res.status(403).json({ error: 'Agotaste los intentos disponibles', attempts });
  let questions = (await q('SELECT id,text,kind,options FROM questions WHERE quiz_id=$1 ORDER BY sort_order,id', [quiz.id])).rows;
  if (quiz.shuffle) questions = questions.sort(() => Math.random() - 0.5);
  res.json({ quiz: { id: quiz.id, title: quiz.title, max_attempts: quiz.max_attempts, time_limit_min: quiz.time_limit_min, passing_score: course.passing_score }, attempts, questions });
}));

router.post('/courses/:slug/quiz/attempt', auth.requireAuth, wrap(async (req, res) => {
  const a = await quizAccess(req, res); if (!a) return;
  const { course, quiz } = a;
  const prev = (await q('SELECT passed FROM quiz_attempts WHERE user_id=$1 AND quiz_id=$2', [req.user.id, quiz.id])).rows;
  if (prev.some(x => x.passed)) return res.status(400).json({ error: 'Ya aprobaste este examen' });
  if (prev.length >= quiz.max_attempts) return res.status(403).json({ error: 'Agotaste los intentos' });
  const answers = (req.body && req.body.answers) || {};
  const questions = (await q('SELECT id,kind,correct FROM questions WHERE quiz_id=$1', [quiz.id])).rows;
  if (!questions.length) return res.status(400).json({ error: 'El examen no tiene preguntas' });
  let ok = 0;
  const detail = {};
  for (const qn of questions) {
    const given = [].concat(answers[qn.id] ?? []).map(Number).sort();
    const correct = [].concat(qn.correct).map(Number).sort();
    const right = given.length === correct.length && given.every((v, i) => v === correct[i]);
    if (right) ok++;
    detail[qn.id] = { given, correct, right };
  }
  const score = Math.round((ok / questions.length) * 100);
  const passed = score >= course.passing_score;
  const att = (await q('INSERT INTO quiz_attempts(user_id,quiz_id,answers,score,passed) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',
    [req.user.id, quiz.id, JSON.stringify(answers), score, passed])).rows[0];
  let certificate = null;
  if (passed) certificate = await certs.issue(req.user.id, course.id, score);
  res.json({ attempt_id: att.id, score, passed, passing_score: course.passing_score, correct: ok, total: questions.length, detail, certificate: certificate && { code: certificate.code } });
}));

// ---------- Compra ----------
router.post('/courses/:slug/order', auth.requireAuth, wrap(async (req, res) => {
  const c = await loadCourse(req.params.slug);
  if (!c || !c.published) return res.status(404).json({ error: 'Curso no encontrado' });
  if (await isEnrolled(req.user.id, c.id)) return res.status(400).json({ error: 'Ya estás inscripto', enrolled: true });
  if (Number(c.price_bs) <= 0) { await payments.enroll(req.user.id, c.id, 'free'); return res.json({ enrolled: true, free: true }); }
  const o = await payments.createOrder({ id: req.user.id }, c);
  res.json(orderView(o));
}));

function orderView(o) {
  return { id: o.id, course_id: o.course_id, amount_bs: o.amount_bs, method: o.method, status: o.status, qr_image: o.qr_image, qr_due_date: o.qr_due_date, has_receipt: !!o.receipt_mime, receipt_note: o.receipt_note, created_at: o.created_at, paid_at: o.paid_at };
}

router.get('/orders/:id', auth.requireAuth, wrap(async (req, res) => {
  let o = (await q('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
  if (o.status === 'pending' && o.method === 'qr_baneco' && req.query.check !== '0') {
    try { o = await payments.checkOrder(o); } catch (e) { console.error('[orders] check', e.message); }
  }
  res.json(orderView(o));
}));

router.post('/orders/:id/receipt', auth.requireAuth, upload.single('receipt'), wrap(async (req, res) => {
  const o = (await q('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
  if (o.status !== 'pending') return res.status(400).json({ error: 'La orden ya no está pendiente' });
  const note = (req.body && req.body.note) || null;
  if (req.file) {
    if (!/^image\/|^application\/pdf$/.test(req.file.mimetype)) return res.status(400).json({ error: 'Subí una imagen o PDF' });
    await q('UPDATE orders SET receipt=$2, receipt_mime=$3, receipt_note=$4 WHERE id=$1', [o.id, req.file.buffer, req.file.mimetype, note]);
  } else if (note) {
    await q('UPDATE orders SET receipt_note=$2 WHERE id=$1', [o.id, note]);
  } else return res.status(400).json({ error: 'Adjuntá el comprobante o una nota' });
  res.json({ ok: true });
}));

router.post('/orders/:id/cancel', auth.requireAuth, wrap(async (req, res) => {
  const o = (await q("SELECT * FROM orders WHERE id=$1 AND user_id=$2 AND status='pending'", [req.params.id, req.user.id])).rows[0];
  if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
  if (o.qr_id) { try { await baneco.cancelQR(o.qr_id); } catch (e) { /* 403 ambiguo: se verifica con status igual */ } }
  await q("UPDATE orders SET status='cancelled' WHERE id=$1 AND status='pending'", [o.id]);
  res.json({ ok: true });
}));

// ---------- Certificados ----------
router.get('/me/certificates', auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await q('SELECT c.code,c.score,c.issued_at,co.title,co.slug FROM certificates c JOIN courses co ON co.id=c.course_id WHERE c.user_id=$1 ORDER BY c.issued_at DESC', [req.user.id]);
  res.json(rows);
}));

router.get('/certificates/:code', wrap(async (req, res) => {
  const c = await certs.findByCode(req.params.code);
  if (!c) return res.status(404).json({ valid: false, error: 'Certificado no encontrado' });
  res.json({ valid: true, ...c });
}));

router.get('/certificates/:code/pdf', wrap(async (req, res) => {
  const c = await certs.findByCode(req.params.code);
  if (!c) return res.status(404).json({ error: 'Certificado no encontrado' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="certificado-${c.code}.pdf"`);
  const doc = await certs.pdfStream(c, baseUrl(req));
  doc.pipe(res);
}));

module.exports = router;
