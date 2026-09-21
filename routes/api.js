// routes/api.js — API pública + alumno
const express = require('express');
const multer = require('multer');
const { q, getSettings } = require('../db');
const auth = require('../auth');
const { embedFor } = require('../video');
const payments = require('../payments');
const certs = require('../certificates');
const baneco = require('../baneco');
const live = require('../live');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

function baseUrl(req) {
  return process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
}

// ---------- Config pública ----------
router.get('/config', wrap(async (req, res) => {
  const s = await getSettings(req.tenant.id);
  res.json({
    tenant: { id: req.tenant.id, slug: req.tenant.slug, name: req.tenant.name, status: req.tenant.status },
    brand_name: s.brand_name === 'SG Academia' && req.tenant.id !== 1 ? req.tenant.name : s.brand_name, brand_tagline: s.brand_tagline, currency: s.currency,
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
  if (req.tenant.status === 'suspended') return res.status(403).json({ error: 'Esta academia está suspendida' });
  const dup = await q('SELECT id FROM users WHERE tenant_id=$2 AND lower(email)=$1', [em, req.tenant.id]);
  if (dup.rows.length) return res.status(409).json({ error: 'Ese email ya está registrado' });
  const { rows } = await q('INSERT INTO users(email,password_hash,name,phone,tenant_id) VALUES($1,$2,$3,$4,$5) RETURNING id,email,name,role,phone,tenant_id',
    [em, await auth.hash(password), String(name).trim(), phone || null, req.tenant.id]);
  res.json({ token: auth.sign(rows[0]), user: rows[0] });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await q('SELECT * FROM users WHERE tenant_id=$2 AND lower(email)=$1', [String(email || '').trim().toLowerCase(), req.tenant.id]);
  const u = rows[0];
  if (!u || !(await auth.verify(String(password || ''), u.password_hash))) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  res.json({ token: auth.sign(u), user: { id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone } });
}));

router.get('/me', auth.requireAuth, wrap(async (req, res) => {
  const u = (await q('SELECT id,email,name,role,phone,created_at FROM users WHERE id=$1 AND tenant_id=$2', [req.user.id, req.tenant.id])).rows[0];
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
    FROM courses c WHERE c.published AND c.tenant_id=$1 ORDER BY c.sort_order, c.id`, [req.tenant.id]);
  res.json(rows);
}));

async function loadCourse(slug, tenantId) {
  const { rows } = await q('SELECT * FROM courses WHERE slug=$1 AND tenant_id=$2', [slug, tenantId]);
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
  const c = await loadCourse(req.params.slug, req.tenant.id);
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
  const owner = (await q('SELECT tenant_id FROM courses WHERE id=$1', [l.course_id])).rows[0];
  if (!owner || owner.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'Lección no encontrada' });
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
  const c = await loadCourse(req.params.slug, req.tenant.id);
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
  const c = await loadCourse(req.params.slug, req.tenant.id);
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
  const doc = await certs.pdfStream(c, baseUrl(req), c.tenant_id);
  doc.pipe(res);
}));

// ---------- Aulas en vivo (alumno) ----------
function classroomView(c, uid) {
  const w = live.window(c);
  return { id: c.id, course_id: c.course_id, course_title: c.course_title, slug: c.slug, title: c.title, description: c.description, starts_at: c.starts_at, duration_min: c.duration_min, mode: c.mode, status: c.status,
    recording_lesson_id: c.recording_lesson_id, attended: !!c.attended, can_join: w.canJoin, is_past: w.isPast, opens_at: w.opensAt, ends_at: w.endsAt };
}

router.get('/me/aulas', auth.requireAuth, wrap(async (req, res) => {
  const admin = req.user.role === 'admin';
  const { rows } = await q(`
    SELECT cl.*, co.title AS course_title, co.slug, (a.user_id IS NOT NULL) AS attended
    FROM classrooms cl JOIN courses co ON co.id=cl.course_id
    LEFT JOIN classroom_attendance a ON a.classroom_id=cl.id AND a.user_id=$1
    WHERE cl.status <> 'cancelled' AND (${admin ? 'true' : 'EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id=$1 AND e.course_id=cl.course_id)'})
    ORDER BY cl.starts_at DESC LIMIT 200`, [req.user.id]);
  const list = rows.map(c => classroomView(c, req.user.id));
  res.json({ upcoming: list.filter(c => !c.is_past).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), past: list.filter(c => c.is_past) });
}));

router.get('/courses/:slug/aulas', auth.optionalAuth, wrap(async (req, res) => {
  const c = await loadCourse(req.params.slug, req.tenant.id);
  if (!c) return res.status(404).json({ error: 'Curso no encontrado' });
  const uid = req.user ? req.user.id : 0;
  const { rows } = await q(`SELECT cl.*, $2::text AS course_title, $3::text AS slug, (a.user_id IS NOT NULL) AS attended FROM classrooms cl
    LEFT JOIN classroom_attendance a ON a.classroom_id=cl.id AND a.user_id=$4
    WHERE cl.course_id=$1 AND cl.status <> 'cancelled' ORDER BY cl.starts_at`, [c.id, c.title, c.slug, uid]);
  res.json(rows.map(r => classroomView(r, uid)));
}));

router.get('/aulas/:id', auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await q('SELECT cl.*, co.title AS course_title, co.slug, co.tenant_id FROM classrooms cl JOIN courses co ON co.id=cl.course_id WHERE cl.id=$1', [req.params.id]);
  const c = rows[0];
  if (!c || c.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'Aula no encontrada' });
  const admin = req.user.role === 'admin';
  if (!admin && !(await isEnrolled(req.user.id, c.course_id))) return res.status(403).json({ error: 'Necesitás estar inscripto en el curso' });
  const att = await q('SELECT 1 FROM classroom_attendance WHERE classroom_id=$1 AND user_id=$2', [c.id, req.user.id]);
  c.attended = att.rows.length > 0;
  res.json(classroomView(c, req.user.id));
}));

router.post('/aulas/:id/join', auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await q('SELECT cl.*, co.title AS course_title, co.slug, co.tenant_id FROM classrooms cl JOIN courses co ON co.id=cl.course_id WHERE cl.id=$1', [req.params.id]);
  const c = rows[0];
  if (!c || c.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'Aula no encontrada' });
  const admin = req.user.role === 'admin';
  if (!admin && !(await isEnrolled(req.user.id, c.course_id))) return res.status(403).json({ error: 'Necesitás estar inscripto en el curso' });
  const w = live.window(c);
  if (!admin && !w.canJoin) return res.status(403).json({ error: w.isPast ? 'Esta aula ya terminó' : `El aula abre el ${new Date(w.opensAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}` });
  if (!c.room_name && c.mode === 'jitsi') { c.room_name = live.roomName(c); await q('UPDATE classrooms SET room_name=$2 WHERE id=$1', [c.id, c.room_name]); }
  await q('INSERT INTO classroom_attendance(classroom_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [c.id, req.user.id]);
  if (admin && c.status === 'scheduled') await q("UPDATE classrooms SET status='live' WHERE id=$1", [c.id]);
  const u = (await q('SELECT id,name,email FROM users WHERE id=$1', [req.user.id])).rows[0];
  res.json({ classroom: classroomView(c, req.user.id), join: live.joinPayload(c, u, admin, req.headers['x-forwarded-host'] || req.get('host')) });
}));

module.exports = router;
