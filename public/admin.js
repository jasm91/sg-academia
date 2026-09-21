/* SG Academia — panel de administración */
(function () {
  'use strict';
  const S = window.SGA; const { api, esc, money, fdate, fdt, toast, state, route, accordion, statusPill, kindIcon } = S;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');

  function guard() {
    if (!state.user) { S.requireLogin(); return false; }
    if (state.user.role !== 'admin') { app.innerHTML = '<div class="alert bad">Solo administradores</div>'; return false; }
    return true;
  }
  function tabs(active) {
    const t = [['', 'Resumen'], ['/cursos', 'Cursos'], ['/aulas', 'Aulas'], ['/cobros', 'Cobros'], ['/alumnos', 'Alumnos'], ['/certificados', 'Certificados'], ['/config', 'Configuración'], ['/soporte', '🛟 Soporte']];
    return `<div class="tabs">${t.map(([p, l]) => `<a href="#/admin${p}" class="${active === p ? 'active' : ''}">${l}</a>`).join('')}</div>`;
  }
  S.adminTabs = tabs;
  function modal(html, onMount) {
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal">${html}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    if (onMount) onMount(bg, close);
    return close;
  }
  const field = (label, name, val, type = 'text', extra = '') => `<label>${label}</label><input name="${name}" type="${type}" value="${esc(val == null ? '' : val)}" ${extra}>`;
  const formData = f => { const o = {}; new FormData(f).forEach((v, k) => o[k] = v); f.querySelectorAll('input[type=checkbox]').forEach(c => o[c.name] = c.checked); return o; };

  // ---------- Resumen ----------
  route(/^\/admin$/, async () => {
    if (!guard()) return;
    const d = await api('/admin/dashboard'); const s = d.stats;
    const stat = (v, l, tone = '') => `<div class="card stat ${tone}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    app.innerHTML = `${tabs('')}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${stat(money(s.revenue_month), 'Ventas del mes', 'tone-teal')}${stat(money(s.revenue_total), 'Ventas totales')}${stat(s.pending_orders, 'Pagos pendientes', s.pending_orders ? 'tone-warn' : '')}
        ${stat(s.students, 'Alumnos')}${stat(s.enrollments, 'Inscripciones')}${stat(s.certificates, 'Certificados', 'tone-ok')}${stat(`${s.published}/${s.courses}`, 'Cursos publicados')}</div>
      <div class="alert ${d.payment_mode === 'qr_baneco' ? 'ok' : 'warn'}" style="margin-top:1rem">${d.payment_mode === 'qr_baneco' ? 'Cobros con QR Baneco activos (acreditación automática).' : 'Modo manual: falta configurar las credenciales BANECO_* en Railway. Los alumnos ven el QR estático y suben comprobante; vos confirmás en Cobros.'}</div>
      <h2 style="margin-top:1.2rem">Últimas órdenes</h2>
      <div class="tablewrap scroll"><table><thead><tr><th>#</th><th>Alumno</th><th>Curso</th><th>Monto</th><th>Método</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
        ${d.recent.map(o => `<tr><td>${o.id}</td><td>${esc(o.name)}<div class="tiny muted">${esc(o.email)}</div></td><td>${esc(o.title)}</td><td>${money(o.amount_bs)}</td><td class="small">${o.method === 'qr_baneco' ? 'QR Baneco' : 'Manual'}</td><td>${statusPill(o.status)}</td><td class="small">${fdt(o.paid_at || o.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin órdenes</td></tr>'}</tbody></table></div>`;
  });

  // ---------- Cursos ----------
  route(/^\/admin\/cursos$/, async () => {
    if (!guard()) return;
    const list = await api('/admin/courses');
    app.innerHTML = `${tabs('/cursos')}<div class="toolbar"><h2>Cursos</h2><button class="btn" id="new">+ Nuevo curso</button></div>
      <div class="tablewrap"><table><thead><tr><th>Curso</th><th>Precio</th><th>Lecciones</th><th>Alumnos</th><th>Ventas</th><th>Estado</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td><b>${esc(c.title)}</b><div class="tiny muted">/${esc(c.slug)}</div></td><td>${money(c.price_bs)}</td><td>${c.lessons}</td><td>${c.students}</td><td>${c.sales}</td><td>${c.published ? '<span class="pill ok">Publicado</span>' : '<span class="pill neutral">Borrador</span>'}</td><td><a class="btn sm sec" href="#/admin/curso/${c.id}">Editar <span class="arrow">→</span></a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin cursos</td></tr>'}</tbody></table></div>`;
    $('#new').addEventListener('click', () => courseForm(null, c => location.hash = '#/admin/curso/' + c.id));
  });

  function courseForm(c, done) {
    c = c || {};
    modal(`<h2>${c.id ? 'Editar curso' : 'Nuevo curso'}</h2><form id="cf">
      ${field('Título', 'title', c.title, 'text', 'required')}${field('Subtítulo', 'subtitle', c.subtitle)}
      <label>Descripción (markdown simple)</label><textarea name="description">${esc(c.description || '')}</textarea>
      <div class="row">${field('Precio (Bs)', 'price_bs', c.price_bs ?? 0, 'number', 'step="0.01" min="0"')}${field('Horas', 'hours', c.hours, 'number', 'step="0.5"')}${field('Nota mínima %', 'passing_score', c.passing_score ?? 70, 'number', 'min="1" max="100"')}</div>
      ${field('Instructor', 'instructor', c.instructor)}${field('URL de portada (imagen)', 'cover_url', c.cover_url)}${c.id ? field('Slug (URL)', 'slug', c.slug) : ''}
      <label class="check"><input type="checkbox" name="published" ${c.published ? 'checked' : ''}> Publicado (visible en el catálogo)</label>
      <label class="check"><input type="checkbox" name="require_all_lessons" ${c.require_all_lessons !== false ? 'checked' : ''}> Exigir todas las lecciones antes del examen</label>
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Guardar</button></div></form>`,
      (bg, close) => $('#cf', bg).addEventListener('submit', async ev => { ev.preventDefault(); const b = formData(ev.target); try { const r = c.id ? await api('/admin/courses/' + c.id, { method: 'PUT', body: b }) : await api('/admin/courses', { method: 'POST', body: b }); close(); toast('Curso guardado'); done(r); } catch (e) { toast(e.message, true); } }));
  }

  route(/^\/admin\/curso\/(\d+)(?:\/(\w+))?$/, async (id, tab) => {
    if (!guard()) return;
    tab = tab || 'contenido';
    const d = await api('/admin/courses/' + id + '/full'); const c = d.course;
    const sub = [['contenido', 'Contenido'], ['examen', 'Examen'], ['alumnos', `Alumnos (${d.students.length})`]];
    let body = '';
    if (tab === 'contenido') {
      body = `<div class="toolbar"><span class="muted small">${d.total_lessons} lecciones · arrastrá para reordenar</span><button class="btn sm" id="addSec">+ Sección</button></div>
        <div id="secs">${d.sections.map(s => `<div class="acc open" data-sec="${s.id}"><div class="acc-h"><span class="drag" draggable="true">⋮⋮</span> <span class="secTitle" data-sec="${s.id}">${esc(s.title)}</span>
            <span class="row tight" style="margin-left:auto;flex:0 0 auto" onclick="event.stopPropagation()"><button class="btn sm ghost" data-addles="${s.id}">+ Lección</button><button class="btn sm ghost" data-editsec="${s.id}">✎</button><button class="btn sm danger" data-delsec="${s.id}">✕</button></span></div>
          <div class="acc-b"><div class="lessons" data-sec="${s.id}">${s.lessons.map(l => `<div class="item" draggable="true" data-les="${l.id}"><span class="drag">⋮⋮</span><span class="muted">${kindIcon(l.kind)}</span><div class="grow"><div class="t">${esc(l.title)}</div><div class="tiny muted">${l.kind}${l.provider && l.kind === 'video' ? ' · ' + l.provider : ''}${l.duration_min ? ' · ' + l.duration_min + ' min' : ''}${l.is_preview ? ' · vista previa' : ''}${l.kind === 'video' && !l.video_ref ? ' · <span style="color:var(--warn)">sin video</span>' : ''}</div></div>
            <button class="btn sm ghost" data-editles="${l.id}">✎</button><button class="btn sm danger" data-delles="${l.id}">✕</button></div>`).join('') || '<div class="item muted small">Sin lecciones — agregá una.</div>'}</div></div></div>`).join('') || '<div class="empty">Creá la primera sección.</div>'}</div>`;
    } else if (tab === 'examen') {
      const qz = d.quiz;
      body = `<div class="card" style="margin-bottom:1rem"><div class="pad"><form id="qzf" class="row"><div>${field('Título', 'title', qz.title)}</div><div>${field('Intentos máx.', 'max_attempts', qz.max_attempts, 'number', 'min="1"')}</div><div>${field('Tiempo límite (min, 0 = sin límite)', 'time_limit_min', qz.time_limit_min || 0, 'number', 'min="0"')}</div>
        <div style="flex:0 0 auto;align-self:flex-end"><label class="check"><input type="checkbox" name="shuffle" ${qz.shuffle ? 'checked' : ''}> Mezclar</label></div><div style="flex:0 0 auto;align-self:flex-end"><button class="btn sm">Guardar</button></div></form>
        <div class="tiny muted">Nota mínima: ${c.passing_score}% (se edita en los datos del curso).</div></div></div>
        <div class="toolbar"><b>${qz.questions.length} preguntas</b><button class="btn sm" id="addQ">+ Pregunta</button></div>
        <div class="card">${qz.questions.map((qn, i) => `<div class="q"><div class="row tight" style="justify-content:space-between;align-items:flex-start"><div><b>${i + 1}. ${esc(qn.text)}</b><div class="tiny muted">${qn.kind === 'single' ? 'Opción única' : qn.kind === 'multiple' ? 'Opción múltiple' : 'Verdadero / Falso'}</div></div>
          <span style="flex:0 0 auto"><button class="btn sm ghost" data-editq="${qn.id}">✎</button><button class="btn sm danger" data-delq="${qn.id}">✕</button></span></div>
          ${qn.options.map((o, j) => `<div class="opt ${qn.correct.includes(j) ? 'right' : ''}" style="cursor:default">${qn.correct.includes(j) ? '✓' : '○'} ${esc(o)}</div>`).join('')}</div>`).join('') || '<div class="empty">Sin preguntas todavía.</div>'}</div>`;
    } else {
      body = `<div class="toolbar"><span class="muted small">Inscriptos en este curso</span><button class="btn sm" id="enrollBtn">+ Inscribir alumno</button></div>
        <div class="tablewrap scroll"><table><thead><tr><th>Alumno</th><th>Origen</th><th>Progreso</th><th>Certificado</th><th>Desde</th><th></th></tr></thead><tbody>
        ${d.students.map(s => `<tr><td>${esc(s.name)}<div class="tiny muted">${esc(s.email)}</div></td><td class="small">${esc(s.source)}</td><td>${s.done}/${d.total_lessons}</td><td>${s.certificate ? `<span class="pill ok mono">${esc(s.certificate)}</span>` : '<span class="muted">—</span>'}</td><td class="small">${fdate(s.created_at)}</td><td><button class="btn sm danger" data-unenroll="${s.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin alumnos</td></tr>'}</tbody></table></div>`;
    }
    app.innerHTML = `${tabs('/cursos')}<div class="toolbar"><div><a class="small" href="#/admin/cursos">← Cursos</a><h2 style="margin:0">${esc(c.title)} ${c.published ? '<span class="pill ok">Publicado</span>' : '<span class="pill neutral">Borrador</span>'}</h2><div class="muted small">${money(c.price_bs)} · <a href="#/curso/${esc(c.slug)}" target="_blank">ver como alumno</a></div></div>
      <span class="row tight"><button class="btn sec sm" id="editC">Editar datos</button><button class="btn danger sm" id="delC">Eliminar</button></span></div>
      <div class="tabs">${sub.map(([k, l]) => `<a href="#/admin/curso/${id}/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</div>${body}`;

    $('#editC').addEventListener('click', () => courseForm(c, () => S.render()));
    $('#delC').addEventListener('click', async () => { if (!confirm('¿Eliminar el curso con todo su contenido, inscripciones y certificados? No se puede deshacer.')) return; await api('/admin/courses/' + id, { method: 'DELETE' }); location.hash = '#/admin/cursos'; });

    if (tab === 'contenido') {
      const reload = () => S.render();
      $('#addSec').addEventListener('click', async () => { const t = prompt('Título de la sección', 'Módulo ' + (d.sections.length + 1)); if (!t) return; await api('/admin/courses/' + id + '/sections', { method: 'POST', body: { title: t } }); reload(); });
      app.querySelectorAll('[data-editsec]').forEach(b => b.addEventListener('click', async () => { const s = d.sections.find(x => x.id == b.dataset.editsec); const t = prompt('Título', s.title); if (!t) return; await api('/admin/sections/' + s.id, { method: 'PUT', body: { title: t } }); reload(); }));
      app.querySelectorAll('[data-delsec]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Eliminar la sección y sus lecciones?')) return; await api('/admin/sections/' + b.dataset.delsec, { method: 'DELETE' }); reload(); }));
      app.querySelectorAll('[data-addles]').forEach(b => b.addEventListener('click', () => lessonForm({ section_id: b.dataset.addles }, reload)));
      app.querySelectorAll('[data-editles]').forEach(b => b.addEventListener('click', () => { const l = d.sections.flatMap(s => s.lessons).find(x => x.id == b.dataset.editles); lessonForm(l, reload); }));
      app.querySelectorAll('[data-delles]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Eliminar la lección?')) return; await api('/admin/lessons/' + b.dataset.delles, { method: 'DELETE' }); reload(); }));
      // acordeón (sin cerrar los demás acá: en edición conviene ver todo) + drag&drop de lecciones
      app.querySelectorAll('.acc-h').forEach(h => h.addEventListener('click', e => { if (e.target.closest('button')) return; h.parentElement.classList.toggle('open'); }));
      let dragging = null;
      app.querySelectorAll('.item[draggable]').forEach(it => {
        it.addEventListener('dragstart', () => { dragging = it; it.style.opacity = .5; });
        it.addEventListener('dragend', async () => { it.style.opacity = ''; dragging = null; await saveOrder(); });
        it.addEventListener('dragover', e => { e.preventDefault(); if (!dragging || dragging === it) return; const r = it.getBoundingClientRect(); (e.clientY - r.top > r.height / 2) ? it.after(dragging) : it.before(dragging); });
      });
      app.querySelectorAll('.lessons').forEach(z => z.addEventListener('dragover', e => { e.preventDefault(); if (dragging && !z.contains(dragging) && !z.querySelector('.item[draggable]')) z.appendChild(dragging); }));
      async function saveOrder() {
        const sections = [...app.querySelectorAll('[data-sec].acc')].map(s => ({ id: Number(s.dataset.sec), lessons: [...s.querySelectorAll('.item[data-les]')].map(l => Number(l.dataset.les)) }));
        await api('/admin/courses/' + id + '/reorder', { method: 'PUT', body: { sections } }); toast('Orden guardado');
      }
    } else if (tab === 'examen') {
      $('#qzf').addEventListener('submit', async ev => { ev.preventDefault(); const b = formData(ev.target); b.max_attempts = Number(b.max_attempts); b.time_limit_min = Number(b.time_limit_min); await api('/admin/quizzes/' + d.quiz.id, { method: 'PUT', body: b }); toast('Examen guardado'); });
      $('#addQ').addEventListener('click', () => questionForm(d.quiz.id, null, () => S.render()));
      app.querySelectorAll('[data-editq]').forEach(b => b.addEventListener('click', () => questionForm(d.quiz.id, d.quiz.questions.find(x => x.id == b.dataset.editq), () => S.render())));
      app.querySelectorAll('[data-delq]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Eliminar la pregunta?')) return; await api('/admin/questions/' + b.dataset.delq, { method: 'DELETE' }); S.render(); }));
    } else {
      $('#enrollBtn').addEventListener('click', async () => {
        const students = await api('/admin/students');
        modal(`<h2>Inscribir alumno</h2><label>Alumno</label><select id="stSel">${students.filter(s => s.role !== 'admin').map(s => `<option value="${s.id}">${esc(s.name)} — ${esc(s.email)}</option>`).join('')}</select>
          <p class="tiny muted">Si el alumno no existe, crealo primero en la pestaña Alumnos.</p><div class="row tight" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="okEnroll">Inscribir</button></div>`,
          (bg, close) => $('#okEnroll', bg).addEventListener('click', async () => { await api('/admin/students/' + $('#stSel', bg).value + '/enroll', { method: 'POST', body: { course_id: Number(id) } }); close(); toast('Inscripto'); S.render(); }));
      });
      app.querySelectorAll('[data-unenroll]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Quitar la inscripción?')) return; await api('/admin/students/' + b.dataset.unenroll + '/enroll/' + id, { method: 'DELETE' }); S.render(); }));
    }
  });

  function lessonForm(l, done) {
    const isNew = !l.id;
    modal(`<h2>${isNew ? 'Nueva lección' : 'Editar lección'}</h2><form id="lf">
      ${field('Título', 'title', l.title, 'text', 'required')}
      <div class="row"><div><label>Tipo</label><select name="kind"><option value="video" ${l.kind === 'video' || isNew ? 'selected' : ''}>Video</option><option value="text" ${l.kind === 'text' ? 'selected' : ''}>Texto</option><option value="pdf" ${l.kind === 'pdf' ? 'selected' : ''}>PDF</option></select></div>
        <div><label>Proveedor de video</label><select name="provider"><option value="bunny" ${l.provider === 'bunny' ? 'selected' : ''}>Bunny Stream (protegido)</option><option value="youtube" ${l.provider === 'youtube' || isNew ? 'selected' : ''}>YouTube (no listado)</option><option value="vimeo" ${l.provider === 'vimeo' ? 'selected' : ''}>Vimeo</option><option value="url" ${l.provider === 'url' ? 'selected' : ''}>URL mp4 directa</option></select></div>
        <div>${field('Duración (min)', 'duration_min', l.duration_min || 0, 'number', 'min="0"')}</div></div>
      ${field('ID o URL del video', 'video_ref', l.video_ref, 'text', 'placeholder="ID de YouTube, GUID de Bunny, URL de Vimeo o mp4"')}
      <div class="row tight"><button type="button" class="btn sm sec" id="bunnyPick">Elegir de Bunny</button><button type="button" class="btn sm sec" id="bunnyUp">Subir video a Bunny</button><span class="tiny muted" id="bunnyMsg"></span></div>
      <label>Contenido (texto/markdown para lecciones de texto, URL para PDF, notas opcionales para video)</label><textarea name="content">${esc(l.content || '')}</textarea>
      <label class="check"><input type="checkbox" name="is_preview" ${l.is_preview ? 'checked' : ''}> Vista previa gratuita (visible sin comprar)</label>
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Guardar</button></div></form>`,
      (bg, close) => {
        const f = $('#lf', bg);
        f.addEventListener('submit', async ev => { ev.preventDefault(); const b = formData(f); b.duration_min = Number(b.duration_min); try { if (isNew) await api('/admin/sections/' + l.section_id + '/lessons', { method: 'POST', body: b }); else await api('/admin/lessons/' + l.id, { method: 'PUT', body: b }); close(); toast('Lección guardada'); done(); } catch (e) { toast(e.message, true); } });
        $('#bunnyPick', bg).addEventListener('click', async () => {
          try { const vids = await api('/admin/bunny/videos'); modal(`<h2>Videos en Bunny</h2><div class="list scroll">${vids.map(v => `<div class="item clickable" data-g="${v.guid}"><div class="grow"><div class="t">${esc(v.title)}</div><div class="tiny muted mono">${v.guid} · ${Math.round(v.length / 60)} min · ${v.status === 4 ? 'listo' : 'procesando ' + v.encodeProgress + '%'}</div></div></div>`).join('') || '<div class="empty">Sin videos</div>'}</div><div class="row tight" style="justify-content:flex-end;margin-top:.8rem"><button class="btn ghost" data-close>Cerrar</button></div>`,
            (bg2, close2) => bg2.querySelectorAll('[data-g]').forEach(el => el.addEventListener('click', () => { f.video_ref.value = el.dataset.g; f.provider.value = 'bunny'; close2(); }))); }
          catch (e) { toast(e.message, true); }
        });
        $('#bunnyUp', bg).addEventListener('click', () => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*';
          inp.onchange = async () => {
            const file = inp.files[0]; if (!file) return; const msg = $('#bunnyMsg', bg);
            try {
              msg.textContent = 'Creando video…';
              const v = await api('/admin/bunny/videos', { method: 'POST', body: { title: f.title.value || file.name } });
              if (!window.tus) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
              const up = new window.tus.Upload(file, { endpoint: v.endpoint, retryDelays: [0, 3000, 5000, 10000], headers: { AuthorizationSignature: v.signature, AuthorizationExpire: String(v.expiration), VideoId: v.guid, LibraryId: String(v.library) }, metadata: { filetype: file.type, title: f.title.value || file.name },
                onError: e => { msg.textContent = 'Error: ' + e.message; }, onProgress: (b, t) => { msg.textContent = 'Subiendo ' + Math.round(b / t * 100) + '%'; }, onSuccess: () => { msg.textContent = 'Subido ✓ (Bunny lo procesa en minutos)'; f.video_ref.value = v.guid; f.provider.value = 'bunny'; } });
              up.start();
            } catch (e) { msg.textContent = 'Error: ' + e.message; }
          };
          inp.click();
        });
      });
  }

  function questionForm(quizId, qn, done) {
    qn = qn || { kind: 'single', options: ['', '', '', ''], correct: [] };
    const opts = qn.kind === 'truefalse' ? ['Verdadero', 'Falso'] : (qn.options.length ? qn.options : ['', '', '', '']);
    modal(`<h2>${qn.id ? 'Editar pregunta' : 'Nueva pregunta'}</h2><form id="qf"><label>Pregunta</label><textarea name="text" required>${esc(qn.text || '')}</textarea>
      <label>Tipo</label><select name="kind"><option value="single" ${qn.kind === 'single' ? 'selected' : ''}>Opción única</option><option value="multiple" ${qn.kind === 'multiple' ? 'selected' : ''}>Opción múltiple</option><option value="truefalse" ${qn.kind === 'truefalse' ? 'selected' : ''}>Verdadero / Falso</option></select>
      <label>Opciones (marcá las correctas)</label><div id="opts">${opts.map((o, j) => optRow(o, j, qn.correct.includes(j), qn.kind)).join('')}</div>
      <button type="button" class="btn sm ghost" id="addOpt" style="margin-top:.4rem">+ Opción</button>
      <label>Explicación (opcional, se muestra al corregir)</label><input name="explanation" value="${esc(qn.explanation || '')}">
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Guardar</button></div></form>`,
      (bg, close) => {
        const f = $('#qf', bg);
        const refresh = () => { const k = f.kind.value; if (k === 'truefalse') $('#opts', bg).innerHTML = optRow('Verdadero', 0, false, k) + optRow('Falso', 1, false, k); else bg.querySelectorAll('#opts input[type=radio],#opts input[type=checkbox]').forEach(i => i.type = k === 'multiple' ? 'checkbox' : 'radio'); };
        f.kind.addEventListener('change', refresh);
        $('#addOpt', bg).addEventListener('click', () => { const n = bg.querySelectorAll('#opts .row').length; $('#opts', bg).insertAdjacentHTML('beforeend', optRow('', n, false, f.kind.value)); });
        f.addEventListener('submit', async ev => {
          ev.preventDefault();
          const rows = [...bg.querySelectorAll('#opts .row')];
          const options = rows.map(r => r.querySelector('input[type=text]').value.trim());
          const correct = rows.map((r, j) => r.querySelector('input[name=correct]').checked ? j : -1).filter(j => j >= 0);
          const keep = options.map((o, j) => o ? j : -1).filter(j => j >= 0);
          const body = { text: f.text.value, kind: f.kind.value, options: keep.map(j => options[j]), correct: correct.filter(j => keep.includes(j)).map(j => keep.indexOf(j)), explanation: f.explanation.value };
          if (body.options.length < 2) return toast('Poné al menos 2 opciones', true);
          if (!body.correct.length) return toast('Marcá al menos una correcta', true);
          try { if (qn.id) await api('/admin/questions/' + qn.id, { method: 'PUT', body }); else await api('/admin/quizzes/' + quizId + '/questions', { method: 'POST', body }); close(); toast('Pregunta guardada'); done(); } catch (e) { toast(e.message, true); }
        });
      });
    function optRow(o, j, checked, kind) { return `<div class="row tight" style="margin:.25rem 0"><input type="${kind === 'multiple' ? 'checkbox' : 'radio'}" name="correct" ${checked ? 'checked' : ''} style="width:auto;flex:0 0 auto" title="Correcta"><input type="text" value="${esc(o)}" placeholder="Opción ${j + 1}" style="flex:1" ${kind === 'truefalse' ? 'readonly' : ''}></div>`; }
  }

  // ---------- Cobros ----------
  route(/^\/admin\/cobros(?:\/(\w+))?$/, async st => {
    if (!guard()) return;
    st = st || 'pending';
    const list = await api('/admin/orders' + (st === 'all' ? '' : '?status=' + st));
    const f = [['pending', 'Pendientes'], ['paid', 'Pagadas'], ['all', 'Todas']];
    app.innerHTML = `${tabs('/cobros')}<div class="toolbar"><h2>Cobros</h2><span class="row tight"><button class="btn sm sec" id="poll">Consultar banco ahora</button><button class="btn sm sec" id="recon">Conciliar el día</button></span></div>
      <div class="tabs">${f.map(([k, l]) => `<a href="#/admin/cobros/${k}" class="${st === k ? 'active' : ''}">${l}</a>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Alumno</th><th>Curso</th><th>Monto</th><th>Método</th><th>Comprobante</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>
      ${list.map(o => `<tr><td>${o.id}</td><td>${esc(o.name)}<div class="tiny muted">${esc(o.email)}${o.phone ? ' · ' + esc(o.phone) : ''}</div></td><td>${esc(o.title)}</td><td><b>${money(o.amount_bs)}</b></td><td class="small">${o.method === 'qr_baneco' ? 'QR Baneco' + (o.qr_id ? `<div class="tiny muted mono">${esc(o.qr_id)}</div>` : '') : 'Manual'}</td>
        <td class="small">${o.has_receipt ? `<a class="btn sm sec" target="_blank" href="/api/admin/orders/${o.id}/receipt?token=${encodeURIComponent(state.token)}">Ver</a>` : ''}${o.receipt_note ? `<div class="tiny muted">${esc(o.receipt_note)}</div>` : ''}</td>
        <td>${statusPill(o.status)}${o.paid_by ? `<div class="tiny muted">por ${esc(o.paid_by)}</div>` : ''}</td><td class="small">${fdt(o.paid_at || o.created_at)}</td>
        <td><div class="row tight" style="flex-wrap:nowrap">${o.status === 'pending' ? `<button class="btn sm" data-paid="${o.id}">Confirmar pago</button>${o.qr_id ? `<button class="btn sm ghost" data-check="${o.id}">Verificar</button>` : ''}<button class="btn sm danger" data-cancel="${o.id}">✕</button>` : ''}</div></td></tr>`).join('') || `<tr><td colspan="9" class="empty">Sin órdenes ${st === 'pending' ? 'pendientes' : ''}</td></tr>`}</tbody></table></div>`;
    app.querySelectorAll('[data-paid]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Confirmar el pago e inscribir al alumno?')) return; await api('/admin/orders/' + b.dataset.paid + '/mark-paid', { method: 'POST', body: {} }); toast('Pago confirmado'); S.render(); }));
    app.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', async () => { try { const r = await api('/admin/orders/' + b.dataset.check + '/check', { method: 'POST' }); toast(r.status === 'paid' ? 'Pagada ✓' : 'Sigue ' + r.status); S.render(); } catch (e) { toast(e.message, true); } }));
    app.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Cancelar la orden?')) return; await api('/admin/orders/' + b.dataset.cancel + '/cancel', { method: 'POST' }); S.render(); }));
    $('#poll').addEventListener('click', async () => { try { const r = await api('/admin/baneco/poll', { method: 'POST' }); toast(`Consultadas ${r.checked}, acreditadas ${r.paid || 0}`); S.render(); } catch (e) { toast(e.message, true); } });
    $('#recon').addEventListener('click', async () => { try { const r = await api('/admin/baneco/reconcile', { method: 'POST', body: {} }); toast(r.error || `Banco: ${r.bankPaid} pagos, acreditados ${r.credited}`, !!r.error); S.render(); } catch (e) { toast(e.message, true); } });
  });

  // ---------- Alumnos ----------
  route(/^\/admin\/alumnos$/, async () => {
    if (!guard()) return;
    const list = await api('/admin/students');
    app.innerHTML = `${tabs('/alumnos')}<div class="toolbar"><h2>Alumnos</h2><span class="row tight"><input id="filter" placeholder="Buscar…" style="width:220px"><button class="btn" id="newS">+ Alumno</button></span></div>
      <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>WhatsApp</th><th>Rol</th><th>Cursos</th><th>Certif.</th><th>Alta</th><th></th></tr></thead><tbody id="tb">
      ${list.map(u => `<tr data-row="${esc((u.name + ' ' + u.email).toLowerCase())}"><td><b>${esc(u.name)}</b></td><td class="small">${esc(u.email)}</td><td class="small">${esc(u.phone || '')}</td><td>${u.role === 'admin' ? '<span class="pill teal">admin</span>' : '<span class="pill neutral">alumno</span>'}</td><td>${u.enrollments}</td><td>${u.certificates}</td><td class="small">${fdate(u.created_at)}</td>
        <td><div class="row tight" style="flex-wrap:nowrap"><button class="btn sm ghost" data-pw="${u.id}">Clave</button>${u.id !== state.user.id ? `<button class="btn sm ghost" data-role="${u.id}" data-cur="${u.role}">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
    $('#filter').addEventListener('input', e => { const v = e.target.value.toLowerCase(); app.querySelectorAll('[data-row]').forEach(r => r.style.display = r.dataset.row.includes(v) ? '' : 'none'); });
    $('#newS').addEventListener('click', () => modal(`<h2>Nuevo alumno</h2><form id="sf">${field('Nombre', 'name', '', 'text', 'required')}${field('Email', 'email', '', 'email', 'required')}${field('WhatsApp', 'phone', '')}${field('Contraseña (vacío = se genera)', 'password', '')}
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Crear</button></div></form>`,
      (bg, close) => $('#sf', bg).addEventListener('submit', async ev => { ev.preventDefault(); try { const r = await api('/admin/students', { method: 'POST', body: formData(ev.target) }); close(); if (r.password) alert(`Alumno creado. Contraseña generada: ${r.password}`); S.render(); } catch (e) { toast(e.message, true); } })));
    app.querySelectorAll('[data-pw]').forEach(b => b.addEventListener('click', async () => { const p = prompt('Nueva contraseña (mín. 6)'); if (!p || p.length < 6) return; await api('/admin/students/' + b.dataset.pw, { method: 'PUT', body: { password: p } }); toast('Contraseña actualizada'); }));
    app.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', async () => { const nr = b.dataset.cur === 'admin' ? 'student' : 'admin'; if (!confirm(`¿Cambiar rol a ${nr}?`)) return; await api('/admin/students/' + b.dataset.role, { method: 'PUT', body: { role: nr } }); S.render(); }));
  });

  // ---------- Certificados ----------
  route(/^\/admin\/certificados$/, async () => {
    if (!guard()) return;
    const list = await api('/admin/certificates');
    app.innerHTML = `${tabs('/certificados')}<h2>Certificados emitidos (${list.length})</h2>
      <div class="tablewrap"><table><thead><tr><th>Código</th><th>Alumno</th><th>Curso</th><th>Nota</th><th>Emitido</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td class="mono">${esc(c.code)}</td><td>${esc(c.name)}<div class="tiny muted">${esc(c.email)}</div></td><td>${esc(c.title)}</td><td>${c.score != null ? c.score + '%' : ''}</td><td class="small">${fdate(c.issued_at)}</td><td><a class="btn sm sec" target="_blank" href="/api/certificates/${esc(c.code)}/pdf">PDF</a> <a class="btn sm ghost" href="#/verificar/${esc(c.code)}">Verificar</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Todavía no se emitieron certificados</td></tr>'}</tbody></table></div>`;
  });

  // ---------- Configuración ----------
  route(/^\/admin\/config$/, async () => {
    if (!guard()) return;
    const d = await api('/admin/settings'); const s = d.settings;
    app.innerHTML = `${tabs('/config')}<div class="grid cols-2"><div class="card"><div class="pad"><h2>Marca y contacto</h2><form id="cf">
        ${field('Nombre de la academia', 'brand_name', s.brand_name)}${field('Lema', 'brand_tagline', s.brand_tagline)}${field('Moneda (símbolo)', 'currency', s.currency)}${field('WhatsApp de soporte (con código país)', 'support_whatsapp', s.support_whatsapp, 'text', 'placeholder="59170000000"')}
        <h3 style="margin-top:1rem">Certificado</h3>${field('Firma (cargo)', 'certificate_signer', s.certificate_signer)}${field('Pie de página', 'certificate_footer', s.certificate_footer)}
        <h3 style="margin-top:1rem">Pago manual (respaldo)</h3>${field('URL de imagen del QR estático', 'manual_qr_image', s.manual_qr_image, 'text', 'placeholder="https://… o data:image/png;base64,…"')}
        <label>Instrucciones al alumno</label><textarea name="manual_instructions">${esc(s.manual_instructions)}</textarea>
        <button class="btn" style="margin-top:1rem">Guardar</button></form></div></div>
      <div><div class="card"><div class="pad"><h2>Integraciones</h2>
        <div class="kv"><b>Baneco QR</b><span>${d.baneco.configured ? '<span class="pill ok">Configurado</span>' : '<span class="pill warn">Sin credenciales</span>'} <button class="btn sm ghost" id="bh">Probar conexión</button><span id="bhr" class="tiny muted"></span></span>
        <b>Endpoint</b><span class="mono small">${esc(d.baneco.base)}</span>
        <b>Bunny Stream</b><span>${d.bunny.configured ? `<span class="pill ok">Biblioteca ${esc(d.bunny.library)}</span> ${d.bunny.token_auth ? '<span class="pill teal">Embed firmado</span>' : '<span class="pill warn">Sin token de embed</span>'}` : '<span class="pill warn">Sin credenciales</span>'}</span></div>
        <p class="tiny muted" style="margin-top:.8rem">Las credenciales se cargan como variables de entorno en Railway: <span class="mono">BANECO_BASE_URL, BANECO_USER, BANECO_PASSWORD, BANECO_AES_KEY, BANECO_ACCOUNT</span> y <span class="mono">BUNNY_LIBRARY_ID, BUNNY_API_KEY, BUNNY_TOKEN_KEY</span>. Al setearlas, el servicio se redeploya y el modo cambia solo.</p></div></div></div></div>`;
    $('#cf').addEventListener('submit', async ev => { ev.preventDefault(); await api('/admin/settings', { method: 'PUT', body: formData(ev.target) }); state.config = await api('/config'); $('#brandName').textContent = state.config.brand_name; toast('Configuración guardada'); });
    $('#bh').addEventListener('click', async () => { const r = await api('/admin/baneco/health'); $('#bhr').textContent = !r.configured ? 'sin credenciales' : r.ok ? 'OK, token obtenido' : 'Error: ' + r.error; });
  });
})();
