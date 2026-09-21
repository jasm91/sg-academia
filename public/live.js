/* SG Academia — aulas en vivo (alumno + admin) */
(function () {
  'use strict';
  const S = window.SGA; const { api, esc, fdt, toast, state, route } = S;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');
  const modeLabel = m => ({ jitsi: 'Aula virtual (cámara y mic)', youtube: 'Transmisión YouTube', cloudflare: 'Transmisión en vivo', meet: 'Google Meet', zoom: 'Zoom', url: 'Enlace externo' }[m] || m);
  const modeIcon = m => ({ jitsi: '🎥', youtube: '📡', cloudflare: '📡', meet: '🔗', zoom: '🔗', url: '🔗' }[m] || '🎥');
  const fdate = d => new Date(d).toLocaleDateString('es-BO', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  function statusPill(c) {
    if (c.status === 'live') return '<span class="pill ok"><span class="pulse" style="width:7px;height:7px"></span> En vivo</span>';
    if (c.status === 'cancelled') return '<span class="pill neutral">Cancelada</span>';
    if (c.status === 'ended' || c.is_past) return '<span class="pill neutral">Finalizada</span>';
    if (c.can_join) return '<span class="pill ok">Abierta</span>';
    return '<span class="pill info">Programada</span>';
  }
  function countdown(c) {
    const ms = new Date(c.starts_at) - Date.now();
    if (ms <= 0) return 'en curso';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return `en ${d} día${d > 1 ? 's' : ''}`;
    if (h >= 1) return `en ${h} h ${m % 60} min`;
    return `en ${m} min`;
  }
  function classItem(c, showCourse) {
    return `<div class="item clickable" data-aula="${c.id}"><span>${modeIcon(c.mode)}</span><div class="grow"><div class="t">${esc(c.title)}</div>
      <div class="tiny muted">${showCourse ? esc(c.course_title) + ' · ' : ''}${fdate(c.starts_at)} · ${c.duration_min} min${!c.is_past && c.status !== 'live' ? ' · ' + countdown(c) : ''}${c.attended ? ' · asististe' : ''}${c.recording_lesson_id ? ' · grabación disponible' : ''}</div></div>
      ${statusPill(c)}<span class="arrow">→</span></div>`;
  }
  S.classItem = classItem;
  function bindItems(root) { root.querySelectorAll('[data-aula]').forEach(el => el.addEventListener('click', () => location.hash = '#/aula/' + el.dataset.aula)); }
  S.bindAulas = bindItems;

  // ---------- Mis aulas ----------
  route(/^\/aulas$/, async () => {
    if (!S.requireLogin()) return;
    const d = await api('/me/aulas');
    app.innerHTML = `<h1>Mis aulas</h1><p class="muted">Clases en vivo de los cursos en los que estás inscripto. Podés entrar desde 15 minutos antes.</p>
      <div class="grid cols-2"><div class="card"><div class="pad"><h2>Próximas</h2><div class="list scroll">${d.upcoming.map(c => classItem(c, true)).join('') || '<div class="empty">No hay aulas programadas.</div>'}</div></div></div>
      <div class="card"><div class="pad"><h2>Anteriores</h2><div class="list scroll">${d.past.map(c => classItem(c, true)).join('') || '<div class="empty">Todavía no hubo aulas.</div>'}</div></div></div></div>`;
    bindItems(app);
  });

  // ---------- Sala ----------
  let jitsiApi = null;
  route(/^\/aula\/(\d+)$/, async id => {
    if (!S.requireLogin()) return;
    if (jitsiApi) { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; }
    const c = await api('/aulas/' + id);
    const isAdmin = state.user.role === 'admin';
    const head = `<div class="small muted"><a href="#/curso/${esc(c.slug)}">${esc(c.course_title)}</a> › <a href="#/aulas">Mis aulas</a></div>
      <div class="toolbar"><div><h1 style="font-size:1.5rem;margin:0">${esc(c.title)}</h1><div class="muted small">${modeIcon(c.mode)} ${modeLabel(c.mode)} · ${fdate(c.starts_at)} · ${c.duration_min} min</div></div>${statusPill(c)}</div>
      ${c.description ? `<p class="muted">${esc(c.description)}</p>` : ''}`;
    if (!c.can_join && !isAdmin) {
      app.innerHTML = `${head}<div class="card"><div class="pad" style="text-align:center">${c.is_past
        ? `<h2>Esta aula ya finalizó</h2>${c.recording_lesson_id ? `<a class="btn" href="#/leccion/${c.recording_lesson_id}">Ver grabación <span class="arrow">→</span></a>` : '<p class="muted">Si se publicó la grabación, la vas a encontrar en el contenido del curso.</p>'}`
        : `<h2>Abre ${countdown(c)}</h2><p class="muted">Desde las ${new Date(c.opens_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} vas a poder entrar desde acá.</p><button class="btn sec" onclick="location.reload()">Actualizar</button>`}</div></div>`;
      return;
    }
    app.innerHTML = `${head}<div class="card"><div class="pad" style="text-align:center"><p class="muted">Al entrar se registra tu asistencia.</p><button class="btn" id="joinBtn">Entrar al aula <span class="arrow">→</span></button></div></div>`;
    $('#joinBtn').addEventListener('click', async () => {
      $('#joinBtn').disabled = true;
      let r;
      try { r = await api('/aulas/' + id + '/join', { method: 'POST' }); } catch (e) { toast(e.message, true); $('#joinBtn').disabled = false; return; }
      const j = r.join;
      if (j.url) { window.open(j.url, '_blank', 'noopener'); app.innerHTML = `${head}<div class="card"><div class="pad" style="text-align:center"><h2>Aula abierta en otra pestaña</h2><p class="muted">Si no se abrió, usá este enlace:</p><a class="btn sec" target="_blank" rel="noopener" href="${esc(j.url)}">Abrir ${modeLabel(c.mode)}</a></div></div>`; return; }
      if (j.mode === 'youtube' || j.mode === 'cloudflare') {
        app.innerHTML = `${head}${j.video ? `<div class="two" style="grid-template-columns:minmax(0,1fr) 340px"><div class="player">
          <iframe src="${esc(j.video)}" allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowfullscreen></iframe></div>
          ${j.chat ? `<div class="card" style="height:min(70vh,560px);overflow:hidden"><iframe src="${esc(j.chat)}" style="width:100%;height:100%;border:0"></iframe></div>` : ''}</div>` : `<div class="alert warn">${esc(j.note || 'Transmisión no configurada')}</div>`}`;
        return;
      }
      // Jitsi / JaaS
      app.innerHTML = `${head}${j.note ? `<div class="alert info">${esc(j.note)}</div>` : ''}<div id="jitsi" style="height:min(78vh,720px);border-radius:14px;overflow:hidden;background:#000"></div>`;
      await new Promise((res, rej) => { if (window.JitsiMeetExternalAPI && document.querySelector(`script[src="${j.script}"]`)) return res(); const s = document.createElement('script'); s.src = j.script; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el aula')); document.head.appendChild(s); }).catch(e => toast(e.message, true));
      if (!window.JitsiMeetExternalAPI) return;
      jitsiApi = new window.JitsiMeetExternalAPI(j.domain, {
        roomName: j.room, jwt: j.jwt || undefined, parentNode: $('#jitsi'), lang: 'es',
        userInfo: { displayName: state.user.name, email: state.user.email },
        configOverwrite: { prejoinConfig: { enabled: true }, startWithAudioMuted: !j.moderator, startWithVideoMuted: !j.moderator, disableDeepLinking: true, subject: c.title },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, MOBILE_APP_PROMO: false, TOOLBAR_BUTTONS: j.moderator
          ? ['microphone', 'camera', 'desktop', 'chat', 'raisehand', 'participants-pane', 'tileview', 'recording', 'settings', 'hangup', 'security', 'mute-everyone']
          : ['microphone', 'camera', 'chat', 'raisehand', 'tileview', 'settings', 'hangup'] },
      });
      jitsiApi.addListener('readyToClose', () => { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; location.hash = '#/aulas'; });
    });
  });

  // ---------- Admin: Soporte en vivo (comparte pantalla + audio + chat con SG) ----------
  route(/^\/admin\/soporte$/, async () => {
    if (!state.user || state.user.role !== 'admin') { S.requireLogin(); return; }
    if (jitsiApi) { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; }
    const d = await api('/admin/support');
    app.innerHTML = `${S.adminTabs('/soporte')}<div class="card"><div class="pad" style="text-align:center"><h2>Soporte en vivo de SG Bolivia</h2>
      <p class="muted">Al iniciar, compartís tu pantalla con el equipo de soporte, con audio y chat. Vos elegís qué pantalla o ventana mostrar y podés cortar cuando quieras.</p>
      ${d.session ? '<div class="alert info">Tenés una sesión de soporte abierta.</div>' : ''}
      <div class="row tight" style="justify-content:center"><input id="topic" placeholder="¿Con qué necesitás ayuda? (opcional)" style="max-width:360px"><button class="btn" id="startS">${d.session ? 'Volver a la sesión' : 'Iniciar soporte'} <span class="arrow">→</span></button>${d.session ? '<button class="btn ghost" id="closeS">Cerrar sesión</button>' : ''}</div></div></div>`;
    const closeBtn = $('#closeS'); if (closeBtn) closeBtn.addEventListener('click', async () => { await api('/admin/support/close', { method: 'POST' }); toast('Sesión cerrada'); S.render(); });
    $('#startS').addEventListener('click', async () => {
      const r = await api('/admin/support', { method: 'POST', body: { topic: $('#topic').value } });
      const j = r.join;
      app.innerHTML = `${S.adminTabs('/soporte')}<div class="toolbar"><div><b>Sesión de soporte #${r.session.id}</b><div class="tiny muted">El equipo de SG se conecta a esta sala. ${j.note ? esc(j.note) : ''}</div></div><button class="btn ghost sm" id="endS">Terminar y cerrar</button></div>
        <div id="jitsi" style="height:min(78vh,720px);border-radius:14px;overflow:hidden;background:#000"></div>`;
      $('#endS').addEventListener('click', async () => { if (jitsiApi) { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; } await api('/admin/support/close', { method: 'POST' }); S.render(); });
      await new Promise((res, rej) => { if (window.JitsiMeetExternalAPI && document.querySelector(`script[src="${j.script}"]`)) return res(); const sc = document.createElement('script'); sc.src = j.script; sc.onload = res; sc.onerror = () => rej(new Error('No se pudo cargar la sala')); document.head.appendChild(sc); }).catch(e => toast(e.message, true));
      if (!window.JitsiMeetExternalAPI) return;
      jitsiApi = new window.JitsiMeetExternalAPI(j.domain, {
        roomName: j.room, jwt: j.jwt || undefined, parentNode: $('#jitsi'), lang: 'es',
        userInfo: { displayName: state.user.name + ' (' + (state.config.brand_name || '') + ')', email: state.user.email },
        configOverwrite: { prejoinConfig: { enabled: false }, startWithVideoMuted: true, startWithAudioMuted: false, startScreenSharing: true, disableDeepLinking: true, subject: 'Soporte SG' },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, MOBILE_APP_PROMO: false, TOOLBAR_BUTTONS: ['microphone', 'camera', 'desktop', 'chat', 'settings', 'hangup'] },
      });
      jitsiApi.addListener('readyToClose', async () => { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; S.render(); });
    });
  });

  // ---------- Admin: Aulas ----------
  route(/^\/admin\/aulas$/, async () => {
    if (!state.user || state.user.role !== 'admin') { S.requireLogin(); return; }
    const [list, courses, settings] = await Promise.all([api('/admin/aulas'), api('/admin/courses'), api('/admin/settings')]);
    app.innerHTML = `${S.adminTabs('/aulas')}
      <div class="toolbar"><div><h2>Aulas en vivo</h2><div class="tiny muted">Aula virtual: ${settings.live.jaas ? '<span class="pill ok">JaaS configurado (hasta 25 participantes gratis, sin login)</span>' : '<span class="pill warn">meet.jit.si público — el instructor inicia sesión como moderador; para evitarlo cargá JAAS_APP_ID / JAAS_KEY_ID / JAAS_PRIVATE_KEY</span>'}${settings.live.cloudflare ? ' <span class="pill ok">Cloudflare Live</span>' : ''}</div></div><button class="btn" id="newA">+ Programar aula</button></div>
      <div class="tablewrap"><table><thead><tr><th>Aula</th><th>Curso</th><th>Fecha</th><th>Modo</th><th>Asistencia</th><th>Estado</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td><b>${esc(c.title)}</b>${c.recording_lesson_id ? '<div class="tiny muted">grabación publicada</div>' : ''}</td><td class="small">${esc(c.course_title)}</td><td class="small">${fdate(c.starts_at)}<div class="tiny muted">${c.duration_min} min</div></td><td class="small">${modeIcon(c.mode)} ${modeLabel(c.mode)}</td><td>${c.attendees}/${c.enrolled}</td><td>${statusPill({ ...c, is_past: c.isPast, can_join: c.canJoin })}</td>
        <td><div class="row tight" style="flex-wrap:nowrap"><a class="btn sm" href="#/aula/${c.id}">Entrar</a><button class="btn sm ghost" data-edit="${c.id}">✎</button><button class="btn sm ghost" data-att="${c.id}">Lista</button>${c.status !== 'ended' ? `<button class="btn sm sec" data-rec="${c.id}">Grabación</button>` : ''}<button class="btn sm danger" data-del="${c.id}">✕</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay aulas programadas</td></tr>'}</tbody></table></div>`;
    const form = (c) => {
      c = c || {};
      const local = c.starts_at ? new Date(new Date(c.starts_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal"><h2>${c.id ? 'Editar aula' : 'Programar aula'}</h2><form id="af">
        <label>Curso</label><select name="course_id" required>${courses.map(x => `<option value="${x.id}" ${x.id === c.course_id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
        <label>Título</label><input name="title" value="${esc(c.title || '')}" required>
        <div class="row"><div><label>Fecha y hora (Bolivia)</label><input name="starts_at" type="datetime-local" value="${local}" required></div><div><label>Duración (min)</label><input name="duration_min" type="number" min="10" value="${c.duration_min || 60}"></div></div>
        <label>Modo</label><select name="mode">${['jitsi', 'youtube', 'cloudflare', 'meet', 'zoom', 'url'].map(m => `<option value="${m}" ${(c.mode || 'jitsi') === m ? 'selected' : ''}>${modeIcon(m)} ${modeLabel(m)}</option>`).join('')}</select>
        <label>Referencia (ID/URL de YouTube Live, UID de Cloudflare, o link de Meet/Zoom; vacío para aula virtual)</label><input name="join_ref" value="${esc(c.join_ref || '')}">
        <label>Descripción</label><textarea name="description">${esc(c.description || '')}</textarea>
        ${c.id ? `<label>Estado</label><select name="status">${['scheduled', 'live', 'ended', 'cancelled'].map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}
        <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" id="cancelA">Cancelar</button><button class="btn">Guardar</button></div></form></div>`;
      document.body.appendChild(bg);
      $('#cancelA', bg).addEventListener('click', () => bg.remove());
      $('#af', bg).addEventListener('submit', async ev => {
        ev.preventDefault(); const b = Object.fromEntries(new FormData(ev.target).entries());
        b.starts_at = new Date(b.starts_at).toISOString(); b.duration_min = Number(b.duration_min); b.course_id = Number(b.course_id);
        try { if (c.id) await api('/admin/aulas/' + c.id, { method: 'PUT', body: b }); else await api('/admin/aulas', { method: 'POST', body: b }); bg.remove(); toast('Aula guardada'); S.render(); } catch (e) { toast(e.message, true); }
      });
    };
    $('#newA').addEventListener('click', () => form(null));
    app.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => form(list.find(x => x.id == b.dataset.edit))));
    app.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('¿Eliminar el aula?')) return; await api('/admin/aulas/' + b.dataset.del, { method: 'DELETE' }); S.render(); }));
    app.querySelectorAll('[data-att]').forEach(b => b.addEventListener('click', async () => {
      const rows = await api('/admin/aulas/' + b.dataset.att + '/asistencia');
      const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal"><h2>Asistencia (${rows.length})</h2><div class="list scroll">${rows.map(r => `<div class="item"><div class="grow"><div class="t">${esc(r.name)}</div><div class="tiny muted">${esc(r.email)} · ${fdt(r.joined_at)}</div></div></div>`).join('') || '<div class="empty">Nadie entró todavía</div>'}</div><div class="row tight" style="justify-content:flex-end;margin-top:.8rem"><button class="btn ghost" id="cl">Cerrar</button></div></div>`;
      document.body.appendChild(bg); $('#cl', bg).addEventListener('click', () => bg.remove());
    }));
    app.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', () => {
      const c = list.find(x => x.id == b.dataset.rec);
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal"><h2>Publicar grabación</h2><p class="muted small">Se crea una lección de video en el curso (sección "Grabaciones de aulas") y el aula pasa a finalizada.</p><form id="rf">
        <label>Título de la lección</label><input name="title" value="Grabación · ${esc(c.title)}">
        <label>Proveedor</label><select name="provider"><option value="youtube">YouTube</option><option value="bunny">Bunny Stream</option><option value="vimeo">Vimeo</option><option value="url">URL mp4</option></select>
        <label>ID / URL del video</label><input name="video_ref" required placeholder="${c.mode === 'youtube' ? esc(c.join_ref || '') : 'GUID de Bunny o ID de YouTube'}">
        <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" id="cancelR">Cancelar</button><button class="btn">Publicar</button></div></form></div>`;
      document.body.appendChild(bg); $('#cancelR', bg).addEventListener('click', () => bg.remove());
      $('#rf', bg).addEventListener('submit', async ev => { ev.preventDefault(); try { await api('/admin/aulas/' + c.id + '/grabacion', { method: 'POST', body: Object.fromEntries(new FormData(ev.target).entries()) }); bg.remove(); toast('Grabación publicada como lección'); S.render(); } catch (e) { toast(e.message, true); } });
    }));
  });
})();
