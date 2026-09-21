/* SG Academia — SPA (público + alumno). Vanilla JS, hash routing. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');
  const state = { config: null, user: null, token: null, me: null };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `${(state.config && state.config.currency) || 'Bs'} ${Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const fdate = d => d ? new Date(d).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fdt = d => d ? new Date(d).toLocaleString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (state.tenantSlug) headers['x-tenant'] = state.tenantSlug;
    const res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) });
    let data = null;
    try { data = await res.json(); } catch (_) { data = {}; }
    if (res.status === 401 && state.token && !path.startsWith('/auth/')) { logout(false); }
    if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.data = data; e.status = res.status; throw e; }
    return data;
  }
  function toast(msg, bad) {
    const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  function setSession(token, user) {
    state.token = token; state.user = user;
    try { const k = 'sga_token' + (state.tenantSlug ? ':' + state.tenantSlug : ''); if (token) localStorage.setItem(k, token); else localStorage.removeItem(k); } catch (_) {}
    renderNav();
  }
  function logout(go = true) { setSession(null, null); state.me = null; if (go) location.hash = '#/'; }

  // ---------- Router ----------
  const routes = [];
  function route(re, fn) { routes.push({ re, fn }); }
  async function render() {
    const h = location.hash.replace(/^#/, '') || '/';
    window.scrollTo({ top: 0 });
    stopPolling();
    for (const r of routes) {
      const m = h.match(r.re);
      if (m) { try { await r.fn(...m.slice(1)); } catch (e) { app.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; } renderNav(); return; }
    }
    app.innerHTML = '<div class="empty">Página no encontrada</div>';
  }
  window.addEventListener('hashchange', render);
  function requireLogin(next) {
    if (state.user) return true;
    sessionStorage.setItem('sga_next', next || location.hash);
    location.hash = '#/login';
    return false;
  }

  // ---------- Nav ----------
  function renderNav() {
    const h = location.hash || '#/';
    const link = (href, label) => `<a href="${href}" class="${h.startsWith(href) && href !== '#/' || h === href ? 'active' : ''}">${label}</a>`;
    let html = link('#/', 'Cursos') + link('#/verificar', 'Verificar certificado');
    if (state.user) {
      html += link('#/mis-cursos', 'Mis cursos') + link('#/aulas', 'Aulas');
      if (state.user.role === 'admin') html += link('#/admin', 'Admin');
      html += `<a href="#/perfil" title="${esc(state.user.email)}">${esc(state.user.name.split(' ')[0])}</a><a href="#/salir">Salir</a>`;
    } else html += link('#/login', 'Entrar') + `<a class="btn sm" href="#/registro">Crear cuenta</a>`;
    $('#nav').innerHTML = html;
  }

  // ---------- Helpers UI ----------
  function accordion(container) {
    container.querySelectorAll('.acc-h').forEach(h => h.addEventListener('click', () => {
      const acc = h.parentElement; const open = acc.classList.contains('open');
      container.querySelectorAll('.acc.open').forEach(a => a.classList.remove('open'));
      if (!open) acc.classList.add('open');
    }));
  }
  function md(text) {
    const lines = String(text || '').split('\n'); let out = '', inList = false;
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    for (const l of lines) {
      if (/^\s*[-*] /.test(l)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      if (/^### /.test(l)) out += `<h3>${inline(l.slice(4))}</h3>`;
      else if (/^## /.test(l)) out += `<h2>${inline(l.slice(3))}</h2>`;
      else if (/^# /.test(l)) out += `<h1>${inline(l.slice(2))}</h1>`;
      else if (l.trim() === '') out += '';
      else out += `<p>${inline(l)}</p>`;
    }
    if (inList) out += '</ul>';
    return out;
  }
  const kindIcon = k => k === 'video' ? '▶' : k === 'pdf' ? '📄' : '📝';
  const statusPill = s => ({ pending: '<span class="pill warn">Pendiente</span>', paid: '<span class="pill ok">Pagado</span>', cancelled: '<span class="pill neutral">Cancelada</span>', expired: '<span class="pill bad">Vencida</span>' }[s] || `<span class="pill neutral">${esc(s)}</span>`);

  // ---------- Páginas ----------
  route(/^\/$/, async () => {
    const courses = await api('/courses');
    const c = state.config;
    app.innerHTML = `
      <section class="hero"><h1>${esc(c.brand_name)}</h1><p>${esc(c.brand_tagline)}</p>
        ${state.user ? '' : '<a class="btn" style="background:#fff;color:var(--teal)" href="#/registro">Crear mi cuenta <span class="arrow">→</span></a>'}
      </section>
      <div class="toolbar"><h2>Cursos disponibles</h2><span class="muted small">${courses.length} curso${courses.length === 1 ? '' : 's'}</span></div>
      <div class="grid cols-3">${courses.map(courseCard).join('') || '<div class="empty">Todavía no hay cursos publicados.</div>'}</div>`;
    app.querySelectorAll('.course-card').forEach(el => el.addEventListener('click', () => location.hash = '#/curso/' + el.dataset.slug));
  });

  function courseCard(c) {
    return `<div class="card course-card" data-slug="${esc(c.slug)}">
      <div class="cover" style="${c.cover_url ? `background-image:url('${esc(c.cover_url)}')` : ''}"></div>
      <div class="body"><div class="title">${esc(c.title)}</div><div class="muted small">${esc(c.subtitle || '')}</div>
        <div class="muted tiny">${c.instructor ? esc(c.instructor) + ' · ' : ''}${c.lessons} lecciones${c.hours ? ' · ' + c.hours + ' h' : ''}</div>
        <div class="foot"><span class="price">${Number(c.price_bs) > 0 ? money(c.price_bs) : 'Gratis'}</span><span class="pill teal">${c.students} alumnos</span></div></div></div>`;
  }

  route(/^\/curso\/([^/]+)$/, async slug => {
    const d = await api('/courses/' + slug);
    const aulas = await api('/courses/' + slug + '/aulas').catch(() => []);
    const { course, enrolled, curriculum, quiz, attempts, certificate, pending_order } = d;
    const pct = curriculum.total ? Math.round(curriculum.done / curriculum.total * 100) : 0;
    const passed = attempts.some(a => a.passed);
    const secs = curriculum.sections.map((s, i) => `
      <div class="acc ${i === 0 ? 'open' : ''}"><div class="acc-h">${esc(s.title)}<span class="muted small" style="font-weight:400;margin-left:.5rem">${s.lessons.length} lecciones</span><span class="chev">⌄</span></div>
        <div class="acc-b"><div>${s.lessons.map(l => `
          <div class="item ${enrolled || l.is_preview ? 'clickable' : ''}" ${enrolled || l.is_preview ? `data-lesson="${l.id}"` : ''}>
            <span class="muted">${kindIcon(l.kind)}</span><div class="grow"><div class="t">${esc(l.title)}</div><div class="tiny muted">${l.duration_min ? l.duration_min + ' min' : ''}</div></div>
            ${l.completed ? '<span class="pill ok">Completada</span>' : l.is_preview && !enrolled ? '<span class="pill info">Vista previa</span>' : enrolled ? '' : '<span class="muted">🔒</span>'}
          </div>`).join('') || '<div class="item muted">Sin lecciones</div>'}</div></div></div>`).join('');

    let side = '';
    if (enrolled) {
      side = `<div class="pad"><div class="row tight" style="justify-content:space-between"><b>Tu progreso</b><span class="muted small">${curriculum.done}/${curriculum.total}</span></div>
        <div class="bar" style="margin:.5rem 0 1rem"><i style="width:${pct}%"></i></div>
        ${certificate ? `<div class="cert"><div class="tiny muted">Certificado emitido</div><div class="code">${esc(certificate.code)}</div>
            <a class="btn sm" style="margin-top:.6rem" href="/api/certificates/${esc(certificate.code)}/pdf" target="_blank">Descargar PDF</a></div>`
          : quiz && quiz.questions > 0 ? `<a class="btn block" href="#/examen/${esc(course.slug)}">${passed ? 'Ver resultado' : 'Rendir examen final'} <span class="arrow">→</span></a>
            <div class="tiny muted" style="margin-top:.4rem;text-align:center">${quiz.questions} preguntas · nota mínima ${course.passing_score}% · ${attempts.length}/${quiz.max_attempts} intentos usados</div>`
          : '<div class="muted small">Este curso no tiene examen final.</div>'}
        ${curriculum.sections[0] && curriculum.sections[0].lessons[0] ? `<a class="btn sec block" style="margin-top:.8rem" href="#/leccion/${nextLesson(curriculum)}">${curriculum.done ? 'Continuar' : 'Empezar'} curso</a>` : ''}
      </div>`;
    } else {
      side = `<div class="pad"><div class="price" style="font-size:1.7rem">${Number(course.price_bs) > 0 ? money(course.price_bs) : 'Gratis'}</div>
        <div class="muted small" style="margin-bottom:.9rem">Acceso completo · examen · certificado verificable</div>
        ${pending_order ? `<a class="btn block" href="#/pagar/${pending_order.id}">Continuar pago pendiente <span class="arrow">→</span></a>` : `<button class="btn block" id="buy">${Number(course.price_bs) > 0 ? 'Comprar curso' : 'Inscribirme gratis'} <span class="arrow">→</span></button>`}
        <div class="tiny muted" style="margin-top:.6rem;text-align:center">${state.config.payment_mode === 'qr_baneco' ? 'Pago con QR desde cualquier banco · acceso inmediato' : 'Pago con QR y verificación de comprobante'}</div></div>`;
    }
    app.innerHTML = `<div class="two"><div>
        <div class="card" style="overflow:hidden">${course.cover_url ? `<div style="aspect-ratio:21/9;background:url('${esc(course.cover_url)}') center/cover"></div>` : ''}
          <div class="pad"><h1>${esc(course.title)}</h1><p class="muted">${esc(course.subtitle || '')}</p>
          <div class="row tight small muted">${course.instructor ? `<span>👤 ${esc(course.instructor)}</span>` : ''}<span>${curriculum.total} lecciones</span>${course.hours ? `<span>${course.hours} h</span>` : ''}</div>
          <div class="prose" style="margin-top:.8rem">${md(course.description)}</div></div></div>
        <h2 style="margin:1.4rem 0 .6rem">Contenido del curso</h2>${secs || '<div class="empty">Sin contenido todavía</div>'}
        ${aulas.length ? `<h2 style="margin:1.4rem 0 .6rem">Aulas en vivo</h2><div class="list scroll">${aulas.filter(a => !a.is_past).concat(aulas.filter(a => a.is_past)).map(a => window.SGA.classItem ? window.SGA.classItem(a, false) : '').join('')}</div>` : ''}
      </div><div class="card" style="position:sticky;top:76px">${side}</div></div>`;
    accordion(app);
    app.querySelectorAll('[data-lesson]').forEach(el => el.addEventListener('click', () => { if (requireLogin()) location.hash = '#/leccion/' + el.dataset.lesson; }));
    app.querySelectorAll('[data-aula]').forEach(el => el.addEventListener('click', () => { if (requireLogin()) location.hash = '#/aula/' + el.dataset.aula; }));
    const buy = $('#buy');
    if (buy) buy.addEventListener('click', async () => {
      if (!requireLogin()) return;
      buy.disabled = true;
      try {
        const r = await api('/courses/' + slug + '/order', { method: 'POST' });
        if (r.enrolled) { toast('¡Inscripción lista!'); render(); return; }
        location.hash = '#/pagar/' + r.id;
      } catch (e) { toast(e.message, true); buy.disabled = false; }
    });
  });
  function nextLesson(cur) {
    for (const s of cur.sections) for (const l of s.lessons) if (!l.completed) return l.id;
    return cur.sections[0].lessons[0].id;
  }

  route(/^\/leccion\/(\d+)$/, async id => {
    if (!requireLogin()) return;
    const d = await api('/lessons/' + id);
    const { lesson, embed, progress, prev, next } = d;
    const cd = await api('/courses/' + lesson.slug);
    let media = '';
    if (lesson.kind === 'video') {
      if (embed.type === 'iframe' && embed.src) media = `<div class="player"><iframe src="${esc(embed.src)}" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture;fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
      else if (embed.type === 'video' && embed.src) media = `<div class="player"><video controls controlsList="nodownload" src="${esc(embed.src)}"></video></div>`;
      else media = `<div class="alert warn">Este video todavía no está configurado.</div>`;
    } else if (lesson.kind === 'pdf') media = lesson.content ? `<iframe src="${esc(lesson.content)}" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:12px"></iframe>` : '<div class="alert warn">PDF no configurado</div>';
    const cur = cd.curriculum;
    const pct = cur.total ? Math.round(cur.done / cur.total * 100) : 0;
    const side = cur.sections.map(s => `<div class="acc ${s.lessons.some(l => l.id === lesson.id) ? 'open' : ''}"><div class="acc-h">${esc(s.title)}<span class="chev">⌄</span></div><div class="acc-b"><div>
      ${s.lessons.map(l => `<div class="item clickable ${l.id === lesson.id ? 'active' : ''}" data-go="${l.id}"><span class="muted">${kindIcon(l.kind)}</span><div class="grow"><div class="t">${esc(l.title)}</div></div>${l.completed ? '<span class="pill ok">✓</span>' : ''}</div>`).join('')}</div></div></div>`).join('');
    app.innerHTML = `<div class="two"><div>
      <div class="small muted" style="margin-bottom:.4rem"><a href="#/curso/${esc(lesson.slug)}">${esc(lesson.course_title)}</a> › ${esc(lesson.section_title)}</div>
      <h1 style="font-size:1.5rem">${esc(lesson.title)}</h1>
      ${media}
      ${lesson.kind === 'text' || (lesson.content && lesson.kind === 'video') ? `<div class="card" style="margin-top:1rem"><div class="pad prose">${md(lesson.content)}</div></div>` : ''}
      <div class="lesson-nav">
        <div>${prev ? `<a class="btn ghost" href="#/leccion/${prev}">← Anterior</a>` : ''}</div>
        <div class="row tight"><button class="btn ${progress.completed ? 'sec' : ''}" id="done">${progress.completed ? '✓ Completada' : 'Marcar como completada'}</button>
        ${next ? `<a class="btn ghost" href="#/leccion/${next}">Siguiente →</a>` : (cd.quiz && cd.quiz.questions > 0 && !cd.certificate ? `<a class="btn" href="#/examen/${esc(lesson.slug)}">Ir al examen →</a>` : '')}</div>
      </div></div>
      <div class="card"><div class="pad" style="padding-bottom:.6rem"><b>Contenido</b><div class="row tight small muted" style="justify-content:space-between;margin-top:.3rem"><span>${cur.done}/${cur.total} completadas</span><span>${pct}%</span></div><div class="bar" style="margin-top:.4rem"><i style="width:${pct}%"></i></div></div>
        <div style="padding:0 .8rem .8rem">${side}</div></div></div>`;
    accordion(app);
    app.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => location.hash = '#/leccion/' + el.dataset.go));
    $('#done').addEventListener('click', async () => {
      await api('/lessons/' + id + '/progress', { method: 'POST', body: { completed: true } });
      toast('Lección completada');
      if (next) location.hash = '#/leccion/' + next; else render();
    });
    // Autocompletar videos cuando termina (solo <video> nativo)
    const v = app.querySelector('video');
    if (v) v.addEventListener('ended', () => api('/lessons/' + id + '/progress', { method: 'POST', body: { completed: true } }).then(() => toast('Lección completada')));
  });

  route(/^\/examen\/([^/]+)$/, async slug => {
    if (!requireLogin()) return;
    let d;
    try { d = await api('/courses/' + slug + '/quiz'); }
    catch (e) {
      app.innerHTML = `<div class="form-narrow card"><div class="pad"><h2>Examen final</h2><div class="alert ${e.data && e.data.locked ? 'info' : 'bad'}">${esc(e.message)}</div><a class="btn sec" href="#/curso/${esc(slug)}">Volver al curso</a></div></div>`;
      return;
    }
    if (d.already_passed) {
      const cd = await api('/courses/' + slug);
      app.innerHTML = `<div class="form-narrow card"><div class="pad" style="text-align:center"><h2>¡Examen aprobado!</h2><p class="muted">Ya aprobaste el examen de este curso.</p>
        ${cd.certificate ? `<div class="cert"><div class="tiny muted">Tu certificado</div><div class="code">${esc(cd.certificate.code)}</div><a class="btn sm" style="margin-top:.6rem" href="/api/certificates/${esc(cd.certificate.code)}/pdf" target="_blank">Descargar PDF</a></div>` : ''}
        <a class="btn ghost" style="margin-top:1rem" href="#/curso/${esc(slug)}">Volver al curso</a></div></div>`;
      return;
    }
    const { quiz, questions, attempts } = d;
    app.innerHTML = `<div style="max-width:760px;margin:0 auto"><div class="toolbar"><div><h1 style="font-size:1.5rem">${esc(quiz.title)}</h1><div class="muted small">${questions.length} preguntas · nota mínima ${quiz.passing_score}% · intento ${attempts.length + 1} de ${quiz.max_attempts}${quiz.time_limit_min ? ` · ${quiz.time_limit_min} min` : ''}</div></div>
      ${quiz.time_limit_min ? '<span class="pill teal" id="timer">--:--</span>' : ''}</div>
      <div class="card" id="qform">${questions.map((qn, i) => `<div class="q" data-q="${qn.id}"><div style="font-weight:600;margin-bottom:.4rem">${i + 1}. ${esc(qn.text)}</div>
        ${qn.kind === 'multiple' ? '<div class="tiny muted" style="margin-bottom:.3rem">Seleccioná todas las correctas</div>' : ''}
        ${qn.options.map((o, j) => `<label class="opt"><input type="${qn.kind === 'multiple' ? 'checkbox' : 'radio'}" name="q${qn.id}" value="${j}"> <span>${esc(o)}</span></label>`).join('')}</div>`).join('')}
      <div class="pad"><button class="btn block" id="submit">Enviar respuestas</button></div></div></div>`;
    if (quiz.time_limit_min) {
      let left = quiz.time_limit_min * 60; const t = $('#timer');
      const tick = () => { t.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; if (left-- <= 0) { clearInterval(iv); submit(); } };
      const iv = setInterval(tick, 1000); tick(); state._timer = iv;
    }
    async function submit() {
      if (state._timer) clearInterval(state._timer);
      const answers = {};
      app.querySelectorAll('.q').forEach(qe => { answers[qe.dataset.q] = [...qe.querySelectorAll('input:checked')].map(i => Number(i.value)); });
      const unanswered = Object.values(answers).filter(a => !a.length).length;
      if (unanswered && !confirm(`Tenés ${unanswered} pregunta(s) sin responder. ¿Enviar igual?`)) return;
      $('#submit').disabled = true;
      try {
        const r = await api('/courses/' + slug + '/quiz/attempt', { method: 'POST', body: { answers } });
        app.querySelectorAll('.q').forEach(qe => {
          const det = r.detail[qe.dataset.q]; if (!det) return;
          qe.querySelectorAll('.opt').forEach((o, j) => { if (det.correct.includes(j)) o.classList.add('right'); else if (det.given.includes(j)) o.classList.add('wrong'); o.querySelector('input').disabled = true; });
        });
        $('#submit').outerHTML = `<div class="cert" style="${r.passed ? '' : 'border-color:var(--bad);background:#fff'}"><h2>${r.passed ? '¡Aprobaste!' : 'No alcanzaste la nota mínima'}</h2>
          <p class="muted">Obtuviste <b>${r.score}%</b> (${r.correct}/${r.total} correctas). Nota mínima: ${r.passing_score}%.</p>
          ${r.passed && r.certificate ? `<div class="code">${esc(r.certificate.code)}</div><a class="btn" style="margin-top:.6rem" href="/api/certificates/${esc(r.certificate.code)}/pdf" target="_blank">Descargar certificado</a>` : ''}
          <div style="margin-top:.8rem"><a class="btn ghost" href="#/curso/${esc(slug)}">Volver al curso</a> ${!r.passed && attempts.length + 1 < quiz.max_attempts ? `<a class="btn sec" href="#/examen/${esc(slug)}" onclick="setTimeout(()=>location.reload(),50)">Reintentar</a>` : ''}</div></div>`;
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      } catch (e) { toast(e.message, true); $('#submit').disabled = false; }
    }
    $('#submit').addEventListener('click', submit);
  });

  // ---------- Pago ----------
  let pollTimer = null;
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } if (state._timer) { clearInterval(state._timer); state._timer = null; } }
  route(/^\/pagar\/(\d+)$/, async id => {
    if (!requireLogin()) return;
    const o = await api('/orders/' + id + '?check=0');
    const cd = state.me || null;
    const draw = (o) => {
      const c = state.config;
      let body = '';
      if (o.status === 'paid') body = `<div class="cert"><h2>¡Pago confirmado!</h2><p class="muted">Ya tenés acceso al curso.</p><a class="btn" href="#/mis-cursos">Ir a mis cursos <span class="arrow">→</span></a></div>`;
      else if (o.status !== 'pending') body = `<div class="alert bad">Esta orden está ${o.status === 'expired' ? 'vencida' : 'cancelada'}. Volvé al curso para generar una nueva.</div>`;
      else if (o.method === 'qr_baneco' && o.qr_image) body = `
        <div class="qrbox"><img src="data:image/png;base64,${o.qr_image}" alt="QR de pago"></div>
        <p class="small muted" style="text-align:center;margin-top:.8rem"><span class="pulse"></span> &nbsp;Escaneá el QR desde la app de tu banco. Apenas se acredite, tu acceso se activa solo.${o.qr_due_date ? ` Vence el ${fdate(o.qr_due_date)}.` : ''}</p>
        <div class="row tight" style="justify-content:center;margin-top:.6rem"><button class="btn sec sm" id="checkNow">Ya pagué, verificar</button><button class="btn ghost sm" id="cancelO">Cancelar orden</button></div>`;
      else body = `
        ${c.manual_qr_image ? `<div class="qrbox"><img src="${esc(c.manual_qr_image)}" alt="QR"></div>` : ''}
        <div class="alert info" style="margin-top:.8rem">${esc(c.manual_instructions)}</div>
        ${o.has_receipt ? '<div class="alert ok">Comprobante recibido. Activamos tu acceso al verificarlo.</div>' : ''}
        <form id="rform"><label>Comprobante (imagen o PDF)</label><input type="file" name="receipt" accept="image/*,application/pdf">
          <label>Nota (opcional)</label><input name="note" placeholder="Ej: pagué desde BNB, referencia 1234"><button class="btn block" style="margin-top:.8rem">Enviar comprobante</button></form>
        ${c.support_whatsapp ? `<a class="btn ghost block" style="margin-top:.6rem" target="_blank" href="https://wa.me/${esc(c.support_whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent('Hola, pagué la orden #' + o.id + ' de ' + money(o.amount_bs))}">Avisar por WhatsApp</a>` : ''}`;
      app.innerHTML = `<div class="form-narrow card"><div class="pad"><div class="toolbar"><h2>Pago de la orden #${o.id}</h2>${statusPill(o.status)}</div>
        <div class="kv" style="margin-bottom:1rem"><b>Monto</b><span class="price">${money(o.amount_bs)}</span><b>Método</b><span>${o.method === 'qr_baneco' ? 'QR bancario (acreditación automática)' : 'QR + comprobante'}</span></div>${body}</div></div>`;
      const chk = $('#checkNow'); if (chk) chk.addEventListener('click', () => check(true));
      const can = $('#cancelO'); if (can) can.addEventListener('click', async () => { if (!confirm('¿Cancelar esta orden?')) return; await api('/orders/' + o.id + '/cancel', { method: 'POST' }); stopPolling(); draw(await api('/orders/' + o.id + '?check=0')); });
      const f = $('#rform'); if (f) f.addEventListener('submit', async ev => { ev.preventDefault(); const fd = new FormData(f); try { await api('/orders/' + o.id + '/receipt', { method: 'POST', body: fd }); toast('Comprobante enviado'); draw(await api('/orders/' + o.id + '?check=0')); } catch (e) { toast(e.message, true); } });
    };
    async function check(manual) {
      try { const n = await api('/orders/' + id); if (n.status !== 'pending') { stopPolling(); draw(n); if (n.status === 'paid') toast('¡Pago acreditado!'); } else if (manual) toast('Todavía no figura el pago. Puede tardar unos segundos.'); }
      catch (e) { if (manual) toast(e.message, true); }
    }
    draw(o);
    if (o.status === 'pending' && o.method === 'qr_baneco') pollTimer = setInterval(check, 5000);
  });

  // ---------- Alumno ----------
  route(/^\/mis-cursos$/, async () => {
    if (!requireLogin()) return;
    const me = await api('/me'); state.me = me;
    app.innerHTML = `<h1>Hola, ${esc(me.user.name.split(' ')[0])}</h1>
      ${me.pending_orders.length ? `<div class="card" style="margin-bottom:1rem"><div class="pad"><b>Pagos pendientes</b><div class="list scroll" style="margin-top:.5rem">${me.pending_orders.map(o => `<div class="item clickable" data-pay="${o.id}"><div class="grow"><div class="t">${esc(o.title)}</div><div class="tiny muted">Orden #${o.id} · ${fdt(o.created_at)}</div></div><span class="price small">${money(o.amount_bs)}</span><span class="arrow">→</span></div>`).join('')}</div></div></div>` : ''}
      <h2>Mis cursos</h2>
      <div class="grid cols-3">${me.enrollments.map(e => { const pct = e.total_lessons ? Math.round(e.done_lessons / e.total_lessons * 100) : 0; return `
        <div class="card course-card" data-slug="${esc(e.slug)}"><div class="cover" style="${e.cover_url ? `background-image:url('${esc(e.cover_url)}')` : ''}"></div>
        <div class="body"><div class="title">${esc(e.title)}</div><div class="muted small">${esc(e.subtitle || '')}</div>
        <div class="bar" style="margin-top:.4rem"><i style="width:${pct}%"></i></div><div class="foot"><span class="muted tiny">${e.done_lessons}/${e.total_lessons} lecciones</span>${e.certificate_code ? '<span class="pill ok">Certificado</span>' : `<span class="pill ${pct ? 'info' : 'neutral'}">${pct}%</span>`}</div></div></div>`; }).join('') || '<div class="empty">Todavía no estás inscripto en ningún curso. <a href="#/">Ver cursos</a></div>'}</div>`;
    app.querySelectorAll('.course-card').forEach(el => el.addEventListener('click', () => location.hash = '#/curso/' + el.dataset.slug));
    app.querySelectorAll('[data-pay]').forEach(el => el.addEventListener('click', () => location.hash = '#/pagar/' + el.dataset.pay));
  });

  route(/^\/perfil$/, async () => {
    if (!requireLogin()) return;
    const me = await api('/me'); const certs = await api('/me/certificates');
    app.innerHTML = `<div class="grid cols-2"><div class="card"><div class="pad"><h2>Mi perfil</h2><form id="pf">
        <label>Nombre completo (aparece en el certificado)</label><input name="name" value="${esc(me.user.name)}" required>
        <label>Email</label><input value="${esc(me.user.email)}" disabled>
        <label>WhatsApp</label><input name="phone" value="${esc(me.user.phone || '')}">
        <label>Nueva contraseña (opcional)</label><input name="password" type="password" autocomplete="new-password">
        <button class="btn" style="margin-top:.9rem">Guardar</button></form></div></div>
      <div class="card"><div class="pad"><h2>Mis certificados</h2>
        <div class="list scroll">${certs.map(c => `<div class="item"><div class="grow"><div class="t">${esc(c.title)}</div><div class="tiny muted mono">${esc(c.code)} · ${fdate(c.issued_at)}</div></div><a class="btn sm sec" target="_blank" href="/api/certificates/${esc(c.code)}/pdf">PDF</a></div>`).join('') || '<div class="empty">Todavía no tenés certificados.</div>'}</div></div></div></div>`;
    $('#pf').addEventListener('submit', async ev => { ev.preventDefault(); const fd = new FormData(ev.target); const body = Object.fromEntries(fd.entries()); if (!body.password) delete body.password; try { const r = await api('/me', { method: 'PUT', body }); setSession(r.token, r.user); toast('Perfil guardado'); } catch (e) { toast(e.message, true); } });
  });

  // ---------- Verificación ----------
  route(/^\/verificar(?:\/([^/]+))?$/, async code => {
    app.innerHTML = `<div class="form-narrow card"><div class="pad"><h2>Verificar certificado</h2><p class="muted small">Ingresá el código impreso en el certificado.</p>
      <form id="vf" class="row"><input name="code" placeholder="SGA-XXXX-XXXX-XX" value="${esc(code || '')}" required><button class="btn" style="flex:0 0 auto">Verificar</button></form><div id="vres"></div></div></div>`;
    async function go(c) {
      const r = $('#vres'); r.innerHTML = '<div class="muted small">Verificando…</div>';
      try { const d = await api('/certificates/' + encodeURIComponent(c));
        r.innerHTML = `<div class="cert" style="margin-top:1rem"><span class="pill ok">Certificado válido</span><h2 style="margin-top:.6rem">${esc(d.student)}</h2><p>${esc(d.course)}</p>
          <div class="kv" style="text-align:left;display:inline-grid"><b>Código</b><span class="mono">${esc(d.code)}</span><b>Emitido</b><span>${fdate(d.issued_at)}</span>${d.score != null ? `<b>Calificación</b><span>${d.score}%</span>` : ''}${d.hours ? `<b>Carga horaria</b><span>${d.hours} h</span>` : ''}</div>
          <div style="margin-top:.8rem"><a class="btn sm sec" target="_blank" href="/api/certificates/${esc(d.code)}/pdf">Ver PDF</a></div></div>`;
      } catch (e) { r.innerHTML = `<div class="alert bad" style="margin-top:1rem">${esc(e.message)}</div>`; }
    }
    $('#vf').addEventListener('submit', ev => { ev.preventDefault(); go(new FormData(ev.target).get('code').trim()); });
    if (code) go(code);
  });

  // ---------- Auth ----------
  route(/^\/login$/, async () => {
    app.innerHTML = `<div class="form-narrow card"><div class="pad"><h2>Entrar</h2><form id="lf"><label>Email</label><input name="email" type="email" required autocomplete="email"><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password">
      <button class="btn block" style="margin-top:1rem">Entrar</button></form><p class="small muted" style="margin-top:.8rem;text-align:center">¿No tenés cuenta? <a href="#/registro">Creá una</a></p></div></div>`;
    $('#lf').addEventListener('submit', async ev => { ev.preventDefault(); try { const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(ev.target).entries()) }); afterAuth(r); } catch (e) { toast(e.message, true); } });
  });
  route(/^\/registro$/, async () => {
    app.innerHTML = `<div class="form-narrow card"><div class="pad"><h2>Crear cuenta</h2><form id="rf"><label>Nombre completo (como querés que aparezca en el certificado)</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>WhatsApp (opcional)</label><input name="phone"><label>Contraseña</label><input name="password" type="password" minlength="6" required autocomplete="new-password">
      <button class="btn block" style="margin-top:1rem">Crear cuenta</button></form><p class="small muted" style="margin-top:.8rem;text-align:center">¿Ya tenés cuenta? <a href="#/login">Entrar</a></p></div></div>`;
    $('#rf').addEventListener('submit', async ev => { ev.preventDefault(); try { const r = await api('/auth/register', { method: 'POST', body: Object.fromEntries(new FormData(ev.target).entries()) }); afterAuth(r); } catch (e) { toast(e.message, true); } });
  });
  function afterAuth(r) { setSession(r.token, r.user); const n = sessionStorage.getItem('sga_next'); sessionStorage.removeItem('sga_next'); location.hash = n && !/login|registro/.test(n) ? n : (r.user.role === 'admin' ? '#/admin' : '#/mis-cursos'); }
  route(/^\/salir$/, async () => logout());

  // ---------- Boot ----------
  async function boot() {
    try {
      const t = new URLSearchParams(location.search).get('t');
      if (t) sessionStorage.setItem('sga_t', t);
      state.tenantSlug = sessionStorage.getItem('sga_t') || '';
      state.token = localStorage.getItem('sga_token' + (state.tenantSlug ? ':' + state.tenantSlug : ''));
    } catch (_) {}
    state.config = await api('/config');
    document.title = state.config.brand_name; $('#brandName').textContent = state.config.brand_name;
    $('#foot').innerHTML = `${esc(state.config.brand_name)} · v${esc(state.config.version)} · <a href="#/superadmin" class="muted">SG</a>`;
    if (state.config.tenant && state.config.tenant.status === 'suspended') $('#foot').insertAdjacentHTML('afterbegin', '<div class="alert warn" style="max-width:600px;margin:0 auto 1rem">Esta academia está suspendida. Contactá a SG Bolivia.</div>');
    if (state.token) { try { const me = await api('/me'); state.user = me.user; state.me = me; } catch (_) { setSession(null, null); } }
    renderNav(); render();
  }
  window.SGA = { api, esc, money, fdate, fdt, toast, state, route, md, accordion, statusPill, requireLogin, render, kindIcon };
  boot();
})();
