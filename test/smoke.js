// test/smoke.js — prueba de humo E2E contra un server corriendo (BASE=http://localhost:3000)
const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@sg-academia.local', password: process.env.ADMIN_PASSWORD || 'admin1234' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function call(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
}
(async () => {
  console.log('Smoke test contra', BASE);
  const h = await fetch(BASE + '/health').then(r => r.json()); ok(h.ok, 'health ' + h.version);
  const cfg = (await call('/config')).data; ok(cfg.brand_name, 'config: ' + cfg.brand_name + ' · modo ' + cfg.payment_mode);
  const adm = await call('/auth/login', { method: 'POST', body: ADMIN }); ok(adm.status === 200 && adm.data.user.role === 'admin', 'login admin');
  const at = adm.data.token;
  const courses = (await call('/courses')).data; ok(courses.length >= 1, `catálogo: ${courses.length} curso(s)`);
  const slug = courses[0].slug;
  const email = `alumno${Date.now()}@test.local`;
  const reg = await call('/auth/register', { method: 'POST', body: { name: 'Alumna de Prueba', email, password: 'secreto123' } }); ok(reg.status === 200, 'registro alumno');
  const st = reg.data.token;
  const det = (await call('/courses/' + slug, { token: st })).data; ok(det.enrolled === false && det.curriculum.total > 0, `detalle curso (${det.curriculum.total} lecciones)`);
  const lockedLesson = det.curriculum.sections[0].lessons.find(l => !l.is_preview);
  const locked = await call('/lessons/' + lockedLesson.id, { token: st }); ok(locked.status === 403, 'lección bloqueada sin compra');
  const preview = det.curriculum.sections[0].lessons.find(l => l.is_preview);
  if (preview) { const p = await call('/lessons/' + preview.id, { token: st }); ok(p.status === 200 && p.data.embed.src, 'vista previa accesible'); }
  const ord = await call('/courses/' + slug + '/order', { method: 'POST', token: st }); ok(ord.status === 200 && ord.data.status === 'pending', `orden creada #${ord.data.id} método ${ord.data.method}`);
  const again = await call('/courses/' + slug + '/order', { method: 'POST', token: st }); ok(again.data.id === ord.data.id, 'orden pendiente reutilizada');
  const quizLocked = await call('/courses/' + slug + '/quiz', { token: st }); ok(quizLocked.status === 403, 'examen bloqueado sin inscripción');
  const mp = await call('/admin/orders/' + ord.data.id + '/mark-paid', { method: 'POST', token: at, body: {} }); ok(mp.status === 200 && mp.data.status === 'paid', 'admin confirma pago');
  const mp2 = await call('/admin/orders/' + ord.data.id + '/mark-paid', { method: 'POST', token: at, body: {} }); ok(mp2.status === 400, 'confirmación idempotente');
  const det2 = (await call('/courses/' + slug, { token: st })).data; ok(det2.enrolled === true, 'alumno inscripto');
  const all = det2.curriculum.sections.flatMap(s => s.lessons);
  for (const l of all) { const r = await call('/lessons/' + l.id, { token: st }); ok(r.status === 200, 'lección ' + l.id + ' accesible'); await call('/lessons/' + l.id + '/progress', { method: 'POST', token: st, body: { completed: true } }); }
  const det3 = (await call('/courses/' + slug, { token: st })).data; ok(det3.curriculum.done === det3.curriculum.total, 'progreso 100%');
  const qz = (await call('/courses/' + slug + '/quiz', { token: st })).data; ok(qz.questions && qz.questions.length > 0 && !('correct' in qz.questions[0]), `examen con ${qz.questions.length} preguntas, sin filtrar respuestas`);
  const wrong = {}; for (const qn of qz.questions) wrong[qn.id] = [qn.options.length - 1];
  const a1 = (await call('/courses/' + slug + '/quiz/attempt', { method: 'POST', token: st, body: { answers: wrong } })).data; ok(a1.score < 100, `intento 1: ${a1.score}% (${a1.passed ? 'aprobado' : 'reprobado'})`);
  const right = {}; for (const qn of qz.questions) right[qn.id] = a1.detail[qn.id].correct;
  const a2 = (await call('/courses/' + slug + '/quiz/attempt', { method: 'POST', token: st, body: { answers: right } })).data; ok(a2.score === 100 && a2.passed && a2.certificate, `intento 2: ${a2.score}% aprobado, certificado ${a2.certificate && a2.certificate.code}`);
  const code = a2.certificate.code;
  const v = (await call('/certificates/' + code)).data; ok(v.valid && v.student === 'Alumna de Prueba', 'verificación pública OK');
  const pdf = await call('/certificates/' + code + '/pdf'); ok(pdf.status === 200 && pdf.data.byteLength > 5000, `PDF ${Math.round(pdf.data.byteLength / 1024)} KB`);
  const bad = await call('/certificates/SGA-XXXX-XXXX-XX'); ok(bad.status === 404, 'código inválido rechazado');
  const me = (await call('/me', { token: st })).data; ok(me.enrollments[0].certificate_code === code, '/me con certificado');
  const dash = (await call('/admin/dashboard', { token: at })).data; ok(dash.stats.certificates >= 1, 'dashboard admin');
  const noadm = await call('/admin/dashboard', { token: st }); ok(noadm.status === 403, 'alumno no entra al admin');
  // CRUD de contenido
  const nc = (await call('/admin/courses', { method: 'POST', token: at, body: { title: 'Curso temporal', price_bs: 0, published: true } })).data; ok(nc.id, 'crear curso');
  const sec = (await call('/admin/courses/' + nc.id + '/sections', { method: 'POST', token: at, body: { title: 'S1' } })).data;
  const les = (await call('/admin/sections/' + sec.id + '/lessons', { method: 'POST', token: at, body: { title: 'L1', kind: 'video', provider: 'youtube', video_ref: 'https://youtu.be/ysz5S6PUM-U' } })).data; ok(les.id, 'crear sección + lección');
  const full = (await call('/admin/courses/' + nc.id + '/full', { token: at })).data; ok(full.sections.length === 1 && full.quiz.id, 'full course con quiz auto');
  const qn = (await call('/admin/quizzes/' + full.quiz.id + '/questions', { method: 'POST', token: at, body: { text: '¿2+2?', kind: 'single', options: ['3', '4'], correct: [1] } })).data; ok(qn.id, 'crear pregunta');
  const free = (await call('/courses/' + nc.slug + '/order', { method: 'POST', token: st })).data; ok(free.enrolled && free.free, 'inscripción gratuita directa');
  const dc = await call('/admin/courses/' + nc.id, { method: 'DELETE', token: at }); ok(dc.status === 200, 'eliminar curso');
  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
