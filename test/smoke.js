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

  // ---- Aulas en vivo ----
  const inMin = m => new Date(Date.now() + m * 60000).toISOString();
  const aula = (await call('/admin/aulas', { method: 'POST', token: at, body: { course_id: courses[0].id, title: 'Clase en vivo', starts_at: inMin(5), duration_min: 30, mode: 'jitsi' } })).data; ok(aula.id && aula.room_name, 'crear aula jitsi (abre en 5 min)');
  const yt = (await call('/admin/aulas', { method: 'POST', token: at, body: { course_id: courses[0].id, title: 'Clase YouTube', starts_at: inMin(120), duration_min: 30, mode: 'youtube', join_ref: 'https://youtu.be/ysz5S6PUM-U' } })).data; ok(yt.id, 'crear aula youtube (en 2 h)');
  const mine = (await call('/me/aulas', { token: st })).data; ok(mine.upcoming.length === 2, `alumno ve ${mine.upcoming.length} aulas próximas`);
  const j1 = await call('/aulas/' + aula.id + '/join', { method: 'POST', token: st }); ok(j1.status === 200 && j1.data.join.domain && j1.data.join.room, `alumno entra al aula jitsi (${j1.data.join.provider})`);
  const j2 = await call('/aulas/' + yt.id + '/join', { method: 'POST', token: st }); ok(j2.status === 403, 'aula futura bloqueada (abre 15 min antes)');
  const ja = await call('/aulas/' + yt.id + '/join', { method: 'POST', token: at }); ok(ja.status === 200 && ja.data.join.video, 'admin entra igual (youtube embed)');
  const att = (await call('/admin/aulas/' + aula.id + '/asistencia', { token: at })).data; ok(att.length === 1, 'asistencia registrada');
  const rec = (await call('/admin/aulas/' + aula.id + '/grabacion', { method: 'POST', token: at, body: { provider: 'youtube', video_ref: 'ysz5S6PUM-U' } })).data; ok(rec.lesson && rec.lesson.id, 'grabación publicada como lección');
  const caulas = (await call('/courses/' + slug + '/aulas', { token: st })).data; ok(caulas.some(a => a.recording_lesson_id === rec.lesson.id), 'aula del curso muestra grabación');
  // ---- Soporte en vivo ----
  const sup = (await call('/admin/support', { method: 'POST', token: at, body: { topic: 'no carga el video' } })).data; ok(sup.session && sup.session.status === 'open' && sup.join.room, 'admin abre sesión de soporte');
  // ---- Superadmin ----
  const sl = await call('/super/login', { method: 'POST', body: { token: process.env.SUPER_TOKEN || 'supertest' } }); ok(sl.status === 200 && sl.data.token, 'login superadmin');
  const sk = sl.data.token;
  const noSuper = await call('/super/tenants', { token: st }); ok(noSuper.status === 401, 'alumno no entra al superadmin');
  const ov = (await call('/super/overview', { token: sk })).data; ok(ov.tenants >= 1 && ov.open_support >= 1, `overview: ${ov.tenants} tenants, ${ov.open_support} soporte abierto`);
  const ss = (await call('/super/support', { token: sk })).data; ok(ss.some(x => x.id === sup.session.id && x.status === 'open'), 'superadmin ve la sesión de soporte');
  const sj = (await call('/super/support/' + sup.session.id + '/join', { method: 'POST', token: sk })).data; ok(sj.join.room === sup.join.room && sj.join.moderator, 'superadmin entra a la MISMA sala como moderador');
  await call('/super/support/' + sup.session.id + '/close', { method: 'POST', token: sk });
  const supAfter = (await call('/admin/support', { token: at })).data; ok(!supAfter.session, 'sesión cerrada por superadmin');
  const tn = (await call('/super/tenants', { method: 'POST', token: sk, body: { name: 'Instituto Prueba', slug: 'prueba', admin_email: 'admin@prueba.bo', admin_name: 'Dir. Prueba', admin_password: 'prueba123' } })).data; ok(tn.tenant && tn.tenant.slug === 'prueba' && tn.admin, 'tenant nuevo creado con admin');
  const H = { 'x-tenant': 'prueba' };
  const callT = (path, o = {}) => fetch(BASE + '/api' + path, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...H, ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined }).then(async r => ({ status: r.status, data: await r.json() }));
  const cfgT = (await callT('/config')).data; ok(cfgT.tenant.slug === 'prueba' && cfgT.brand_name === 'Instituto Prueba', 'config del tenant por header x-tenant');
  const lt = await callT('/auth/login', { method: 'POST', body: { email: 'admin@prueba.bo', password: 'prueba123' } }); ok(lt.status === 200 && lt.data.user.role === 'admin', 'login admin del tenant');
  const cross = await callT('/auth/login', { method: 'POST', body: { email: 'admin@sg-academia.local', password: 'admin1234' } }); ok(cross.status === 401, 'admin del tenant 1 NO entra en tenant prueba');
  const crossTok = await callT('/admin/dashboard', { token: at }); ok(crossTok.status === 401, 'token del tenant 1 rechazado en tenant prueba');
  const emptyCat = (await callT('/courses')).data; ok(emptyCat.length === 0, 'catálogo del tenant nuevo vacío (aislado)');
  const cT = (await callT('/admin/courses', { method: 'POST', token: lt.data.token, body: { title: 'Curso demo', price_bs: 50, published: true } })).data; ok(cT.id && cT.slug === 'curso-demo', 'mismo slug permitido en otro tenant');
  const leak = await call('/admin/courses/' + cT.id + '/full', { token: at }); ok(leak.status === 404, 'tenant 1 no ve cursos del tenant prueba');
  const imp = (await call('/super/tenants/' + tn.tenant.id + '/impersonate', { method: 'POST', token: sk })).data; ok(imp.token && imp.slug === 'prueba', 'impersonate devuelve token del tenant');
  const impDash = await callT('/admin/dashboard', { token: imp.token }); ok(impDash.status === 200, 'token impersonado funciona en el tenant');
  await call('/super/tenants/' + tn.tenant.id, { method: 'DELETE', token: sk });
  const gone = (await call('/super/tenants', { token: sk })).data; ok(!gone.some(x => x.slug === 'prueba'), 'tenant eliminado');
  console.log(`\n${pass} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
