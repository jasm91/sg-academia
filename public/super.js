/* SG Academia — panel superadmin de plataforma (SG Bolivia) */
(function () {
  'use strict';
  const S = window.SGA; const { esc, money, fdate, fdt, toast, route } = S;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');
  let superToken = null;
  try { superToken = localStorage.getItem('sga_super'); } catch (_) {}

  async function sapi(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (superToken) headers.Authorization = 'Bearer ' + superToken;
    const res = await fetch('/api/super' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (res.status === 401) { superToken = null; try { localStorage.removeItem('sga_super'); } catch (_) {} }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }
  function tabs(active) {
    const t = [['', 'Tenants'], ['/soporte', '🛟 Soporte'], ['/ventas', 'Ventas'], ['/sistema', 'Sistema']];
    return `<div class="toolbar"><div><h1 style="margin:0;font-size:1.4rem">Superadmin · SG Academia</h1><div class="tiny muted">Plataforma multi-tenant</div></div><button class="btn ghost sm" id="superOut">Salir</button></div>
      <div class="tabs">${t.map(([p, l]) => `<a href="#/superadmin${p}" class="${active === p ? 'active' : ''}">${l}</a>`).join('')}</div>`;
  }
  function bindOut() { const b = $('#superOut'); if (b) b.addEventListener('click', () => { superToken = null; try { localStorage.removeItem('sga_super'); } catch (_) {} location.hash = '#/superadmin'; }); }
  function login() {
    app.innerHTML = `<div class="form-narrow card"><div class="pad"><h2>Superadmin</h2><p class="muted small">Acceso de plataforma (SG Bolivia). Ingresá el token de superadmin.</p>
      <form id="sf"><label>Token</label><input name="token" type="password" required autocomplete="off"><button class="btn block" style="margin-top:1rem">Entrar</button></form></div></div>`;
    $('#sf').addEventListener('submit', async ev => { ev.preventDefault(); try { const r = await sapi('/login', { method: 'POST', body: { token: new FormData(ev.target).get('token') } }); superToken = r.token; try { localStorage.setItem('sga_super', superToken); } catch (_) {} S.render(); } catch (e) { toast(e.message, true); } });
  }
  const guard = () => { if (!superToken) { login(); return false; } return true; };
  const tenantStatus = s => ({ active: '<span class="pill ok">Activo</span>', trial: '<span class="pill info">Prueba</span>', suspended: '<span class="pill bad">Suspendido</span>' }[s] || `<span class="pill neutral">${esc(s)}</span>`);
  function modal(html, onMount) {
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal">${html}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); }); document.body.appendChild(bg);
    const close = () => bg.remove(); bg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close)); if (onMount) onMount(bg, close);
  }
  const field = (label, name, val, type = 'text', extra = '') => `<label>${label}</label><input name="${name}" type="${type}" value="${esc(val == null ? '' : val)}" ${extra}>`;

  // ---------- Tenants ----------
  route(/^\/superadmin$/, async () => {
    if (!guard()) return;
    let ov, list;
    try { [ov, list] = await Promise.all([sapi('/overview'), sapi('/tenants')]); } catch (e) { if (!superToken) return login(); throw e; }
    const stat = (v, l, tone = '') => `<div class="card stat ${tone}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    app.innerHTML = `${tabs('')}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:1rem">${stat(ov.tenants, 'Tenants')}${stat(ov.active, 'Activos', 'tone-ok')}${stat(ov.students, 'Alumnos')}${stat(ov.courses, 'Cursos')}${stat(money(ov.sales_month), 'Ventas del mes', 'tone-teal')}${stat(money(ov.sales_total), 'Ventas totales')}${stat(ov.open_support, 'Soporte abierto', ov.open_support ? 'tone-warn' : '')}</div>
      <div class="toolbar"><h2>Tenants</h2><button class="btn" id="newT">+ Nuevo tenant</button></div>
      <div class="tablewrap"><table><thead><tr><th>Academia</th><th>Slug / dominio</th><th>Plan</th><th>Cursos</th><th>Alumnos</th><th>Ventas mes</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>
      ${list.map(t => `<tr><td><b>${esc(t.name)}</b>${t.open_support ? ' <span class="pill warn">soporte</span>' : ''}</td><td class="small mono">${esc(t.slug)}${t.domain ? `<div class="tiny muted">${esc(t.domain)}</div>` : ''}</td><td class="small">${esc(t.plan || '')}<div class="tiny muted">${money(t.monthly_fee_bs)}/mes</div></td><td>${t.courses}</td><td>${t.students}</td><td>${money(t.sales_month)}</td><td>${money(t.sales_total)}</td><td>${tenantStatus(t.status)}</td>
        <td><div class="row tight" style="flex-wrap:nowrap"><a class="btn sm sec" href="#/superadmin/tenant/${t.id}">Ver <span class="arrow">→</span></a><button class="btn sm" data-imp="${t.id}">Entrar como admin</button></div></td></tr>`).join('')}</tbody></table></div>`;
    bindOut();
    $('#newT').addEventListener('click', () => modal(`<h2>Nuevo tenant</h2><form id="tf">${field('Nombre de la academia', 'name', '', 'text', 'required')}${field('Slug (URL)', 'slug', '', 'text', 'placeholder="isam"')}${field('Dominio propio (opcional)', 'domain', '', 'text', 'placeholder="academia.isam.edu.bo"')}
      <div class="row"><div><label>Estado</label><select name="status"><option value="trial">Prueba</option><option value="active">Activo</option></select></div><div>${field('Plan', 'plan', 'base')}</div><div>${field('Cuota mensual (Bs)', 'monthly_fee_bs', 0, 'number')}</div></div>
      <h3 style="margin-top:1rem">Primer administrador</h3>${field('Email', 'admin_email', '', 'email')}${field('Nombre', 'admin_name', '')}${field('Contraseña (vacío = se genera)', 'admin_password', '')}${field('WhatsApp de soporte de la academia', 'support_whatsapp', '')}
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Crear</button></div></form>`,
      (bg, close) => $('#tf', bg).addEventListener('submit', async ev => { ev.preventDefault(); try { const r = await sapi('/tenants', { method: 'POST', body: Object.fromEntries(new FormData(ev.target).entries()) }); close(); if (r.password) alert(`Tenant creado.\nAdmin: ${r.admin.email}\nContraseña: ${r.password}\nURL: ${location.origin}/?t=${r.tenant.slug}`); S.render(); } catch (e) { toast(e.message, true); } })));
    app.querySelectorAll('[data-imp]').forEach(b => b.addEventListener('click', () => impersonate(b.dataset.imp)));
  });

  async function impersonate(id) {
    const r = await sapi('/tenants/' + id + '/impersonate', { method: 'POST' });
    try { sessionStorage.setItem('sga_t', r.slug); localStorage.setItem('sga_token:' + r.slug, r.token); } catch (_) {}
    window.open(`${location.origin}/?t=${r.slug}#/admin`, '_blank');
  }

  route(/^\/superadmin\/tenant\/(\d+)$/, async id => {
    if (!guard()) return;
    const d = await sapi('/tenants/' + id); const t = d.tenant;
    app.innerHTML = `${tabs('')}<div class="toolbar"><div><a class="small" href="#/superadmin">← Tenants</a><h2 style="margin:0">${esc(t.name)} ${tenantStatus(t.status)}</h2><div class="muted small mono">${esc(t.slug)} · ${t.domain ? esc(t.domain) : 'sin dominio'} · acceso: <a href="/?t=${esc(t.slug)}#/" target="_blank">${location.host}/?t=${esc(t.slug)}</a></div></div>
      <div class="row tight"><button class="btn sec sm" id="editT">Editar</button><button class="btn sm" id="impT">Entrar como admin</button>${t.id !== 1 ? '<button class="btn danger sm" id="delT">Eliminar</button>' : ''}</div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:1rem">
        <div class="card stat"><div class="v">${t.courses}</div><div class="l">Cursos</div></div><div class="card stat"><div class="v">${t.students}</div><div class="l">Alumnos</div></div><div class="card stat tone-teal"><div class="v">${money(t.sales_month)}</div><div class="l">Ventas mes</div></div><div class="card stat"><div class="v">${money(t.sales_total)}</div><div class="l">Ventas total</div></div><div class="card stat ${t.pending_orders ? 'tone-warn' : ''}"><div class="v">${t.pending_orders}</div><div class="l">Pagos pendientes</div></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="pad"><div class="toolbar"><h3>Administradores</h3><button class="btn sm ghost" id="addA">+ Admin</button></div><div class="list scroll">${d.admins.map(a => `<div class="item"><div class="grow"><div class="t">${esc(a.name)}</div><div class="tiny muted">${esc(a.email)} · ${fdate(a.created_at)}</div></div></div>`).join('') || '<div class="empty">Sin admins</div>'}</div>
          <h3 style="margin-top:1rem">Cursos</h3><div class="list scroll">${d.courses.map(c => `<div class="item"><div class="grow"><div class="t">${esc(c.title)}</div><div class="tiny muted">${money(c.price_bs)} · ${c.students} alumnos · ${c.sales} ventas</div></div>${c.published ? '<span class="pill ok">Publicado</span>' : '<span class="pill neutral">Borrador</span>'}</div>`).join('') || '<div class="empty">Sin cursos</div>'}</div></div></div>
        <div class="card"><div class="pad"><h3>Últimas órdenes</h3><div class="list scroll">${d.orders.map(o => `<div class="item"><div class="grow"><div class="t">${esc(o.name)} · ${esc(o.title)}</div><div class="tiny muted">#${o.id} · ${fdt(o.paid_at || o.created_at)}</div></div><b class="small">${money(o.amount_bs)}</b>${S.statusPill(o.status)}</div>`).join('') || '<div class="empty">Sin órdenes</div>'}</div>
          <h3 style="margin-top:1rem">Sesiones de soporte</h3><div class="list scroll">${d.support.map(s => `<div class="item"><div class="grow"><div class="t">#${s.id} ${esc(s.topic || 'sin tema')}</div><div class="tiny muted">${fdt(s.created_at)}</div></div>${s.status === 'open' ? `<a class="btn sm" href="#/superadmin/soporte/${s.id}">Entrar</a>` : '<span class="pill neutral">cerrada</span>'}</div>`).join('') || '<div class="empty">Sin sesiones</div>'}</div>
          ${t.notes ? `<h3 style="margin-top:1rem">Notas</h3><p class="small muted">${esc(t.notes)}</p>` : ''}</div></div></div>`;
    bindOut();
    $('#impT').addEventListener('click', () => impersonate(id));
    const del = $('#delT'); if (del) del.addEventListener('click', async () => { if (prompt(`Escribí "${t.slug}" para eliminar el tenant con TODOS sus datos`) !== t.slug) return; await sapi('/tenants/' + id, { method: 'DELETE' }); location.hash = '#/superadmin'; });
    $('#editT').addEventListener('click', () => modal(`<h2>Editar tenant</h2><form id="ef">${field('Nombre', 'name', t.name)}${t.id !== 1 ? field('Slug', 'slug', t.slug) : ''}${field('Dominio propio', 'domain', t.domain)}
      <div class="row"><div><label>Estado</label><select name="status">${['active', 'trial', 'suspended'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div>${field('Plan', 'plan', t.plan)}</div><div>${field('Cuota mensual (Bs)', 'monthly_fee_bs', t.monthly_fee_bs, 'number')}</div></div>
      ${field('Próximo vencimiento', 'billing_next_due', t.billing_next_due ? String(t.billing_next_due).slice(0, 10) : '', 'date')}<label>Notas internas</label><textarea name="notes">${esc(t.notes || '')}</textarea>
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Guardar</button></div></form>`,
      (bg, close) => $('#ef', bg).addEventListener('submit', async ev => { ev.preventDefault(); try { await sapi('/tenants/' + id, { method: 'PUT', body: Object.fromEntries(new FormData(ev.target).entries()) }); close(); toast('Guardado'); S.render(); } catch (e) { toast(e.message, true); } })));
    $('#addA').addEventListener('click', () => modal(`<h2>Nuevo administrador</h2><form id="af">${field('Email', 'email', '', 'email', 'required')}${field('Nombre', 'name', '')}${field('Contraseña (vacío = se genera)', 'password', '')}
      <div class="row tight" style="justify-content:flex-end;margin-top:1rem"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn">Crear</button></div></form>`,
      (bg, close) => $('#af', bg).addEventListener('submit', async ev => { ev.preventDefault(); try { const r = await sapi('/tenants/' + id + '/admins', { method: 'POST', body: Object.fromEntries(new FormData(ev.target).entries()) }); close(); alert(`Admin: ${r.admin.email}\nContraseña: ${r.password}`); S.render(); } catch (e) { toast(e.message, true); } })));
  });

  // ---------- Soporte ----------
  route(/^\/superadmin\/soporte$/, async () => {
    if (!guard()) return;
    const list = await sapi('/support');
    app.innerHTML = `${tabs('/soporte')}<p class="muted small">Cuando un admin de un tenant inicia "Soporte" desde su panel, aparece acá. Al entrar ves su pantalla, con audio y chat.</p>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Tenant</th><th>Solicitó</th><th>Tema</th><th>Inicio</th><th>Estado</th><th></th></tr></thead><tbody>
      ${list.map(s => `<tr><td>${s.id}</td><td><b>${esc(s.tenant_name)}</b></td><td class="small">${esc(s.requester || '')}<div class="tiny muted">${esc(s.requester_email || '')}</div></td><td class="small">${esc(s.topic || '')}</td><td class="small">${fdt(s.created_at)}</td><td>${s.status === 'open' ? '<span class="pill ok"><span class="pulse" style="width:7px;height:7px"></span> Abierta</span>' : '<span class="pill neutral">Cerrada</span>'}</td>
        <td><div class="row tight" style="flex-wrap:nowrap">${s.status === 'open' ? `<a class="btn sm" href="#/superadmin/soporte/${s.id}">Entrar al visor</a><button class="btn sm ghost" data-close-s="${s.id}">Cerrar</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin sesiones de soporte</td></tr>'}</tbody></table></div>`;
    bindOut();
    app.querySelectorAll('[data-close-s]').forEach(b => b.addEventListener('click', async () => { await sapi('/support/' + b.dataset.closeS + '/close', { method: 'POST' }); S.render(); }));
  });

  let jitsiApi = null;
  route(/^\/superadmin\/soporte\/(\d+)$/, async id => {
    if (!guard()) return;
    if (jitsiApi) { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; }
    const r = await sapi('/support/' + id + '/join', { method: 'POST' }); const j = r.join;
    app.innerHTML = `${tabs('/soporte')}<div class="toolbar"><div><b>Visor · ${esc(r.session.tenant_name)}</b> <span class="tiny muted">sesión #${r.session.id}${r.session.topic ? ' · ' + esc(r.session.topic) : ''}${j.note ? ' · ' + esc(j.note) : ''}</span></div><div class="row tight"><a class="btn ghost sm" href="#/superadmin/soporte">← Sesiones</a><button class="btn sm danger" id="closeS">Cerrar sesión</button></div></div>
      <div id="jitsi" style="height:min(80vh,760px);border-radius:14px;overflow:hidden;background:#000"></div>`;
    bindOut();
    $('#closeS').addEventListener('click', async () => { if (jitsiApi) { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; } await sapi('/support/' + id + '/close', { method: 'POST' }); location.hash = '#/superadmin/soporte'; });
    await new Promise((res, rej) => { if (window.JitsiMeetExternalAPI && document.querySelector(`script[src="${j.script}"]`)) return res(); const sc = document.createElement('script'); sc.src = j.script; sc.onload = res; sc.onerror = () => rej(new Error('No se pudo cargar el visor')); document.head.appendChild(sc); }).catch(e => toast(e.message, true));
    if (!window.JitsiMeetExternalAPI) return;
    jitsiApi = new window.JitsiMeetExternalAPI(j.domain, {
      roomName: j.room, jwt: j.jwt || undefined, parentNode: $('#jitsi'), lang: 'es',
      userInfo: { displayName: 'Soporte SG', email: 'soporte@sg-bolivia.com' },
      configOverwrite: { prejoinConfig: { enabled: false }, startWithVideoMuted: true, startWithAudioMuted: false, disableDeepLinking: true, subject: 'Soporte SG' },
      interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, MOBILE_APP_PROMO: false, TOOLBAR_BUTTONS: ['microphone', 'camera', 'desktop', 'chat', 'tileview', 'settings', 'hangup', 'security'] },
    });
    jitsiApi.addListener('readyToClose', () => { try { jitsiApi.dispose(); } catch (_) {} jitsiApi = null; location.hash = '#/superadmin/soporte'; });
  });

  // ---------- Ventas / Sistema ----------
  route(/^\/superadmin\/ventas$/, async () => {
    if (!guard()) return;
    const list = await sapi('/orders');
    app.innerHTML = `${tabs('/ventas')}<div class="tablewrap"><table><thead><tr><th>#</th><th>Tenant</th><th>Alumno</th><th>Curso</th><th>Monto</th><th>Método</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
      ${list.map(o => `<tr><td>${o.id}</td><td class="small">${esc(o.tenant_name)}</td><td>${esc(o.name)}<div class="tiny muted">${esc(o.email)}</div></td><td class="small">${esc(o.title)}</td><td><b>${money(o.amount_bs)}</b></td><td class="small">${o.method === 'qr_baneco' ? 'QR Baneco' : 'Manual'}</td><td>${S.statusPill(o.status)}</td><td class="small">${fdt(o.paid_at || o.created_at)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sin órdenes</td></tr>'}</tbody></table></div>`;
    bindOut();
  });
  route(/^\/superadmin\/sistema$/, async () => {
    if (!guard()) return;
    const ov = await sapi('/overview');
    const pill = (ok, l) => `<span class="pill ${ok ? 'ok' : 'warn'}">${l}</span>`;
    app.innerHTML = `${tabs('/sistema')}<div class="card"><div class="pad"><h3>Estado</h3><div class="kv"><b>Versión</b><span>v${esc(ov.version)}</span><b>Base de datos</b><span>${esc(ov.db)}</span><b>Baneco QR</b><span>${pill(ov.integrations.baneco, ov.integrations.baneco ? 'Configurado' : 'Sin credenciales (modo manual)')} <button class="btn sm ghost" id="bh">Probar</button> <span id="bhr" class="tiny muted"></span></span>
      <b>Aulas virtuales</b><span>${pill(ov.integrations.jitsi !== 'public', ov.integrations.jitsi === 'self' ? 'Jitsi propio · ' + esc(ov.integrations.jitsi_domain) : ov.integrations.jitsi === 'jaas' ? '8x8 JaaS' : 'meet.jit.si público')}</span><b>Transmisión propia</b><span>${pill(ov.integrations.stream, ov.integrations.stream ? 'MediaMTX · ' + esc(ov.integrations.live_domain) : 'sin servidor (LIVE_DOMAIN)')}</span><b>Bunny Stream</b><span>${pill(ov.integrations.bunny, ov.integrations.bunny ? 'Configurado' : 'Sin credenciales')}</span><b>Cloudflare Live</b><span>${pill(ov.integrations.cloudflare_live, ov.integrations.cloudflare_live ? 'Configurado' : 'No')}</span></div>
      <p class="tiny muted" style="margin-top:1rem">Todas las integraciones se configuran por variables de entorno en Railway (servicio academia-app). Hoy Baneco y Bunny son globales de la plataforma; el cobro por tenant con cuenta propia queda para una próxima versión.</p>
      <button class="btn sm sec" id="poll">Consultar Baneco ahora (todas las órdenes)</button></div></div>`;
    bindOut();
    $('#bh').addEventListener('click', async () => { const r = await sapi('/baneco/health'); $('#bhr').textContent = !r.configured ? 'sin credenciales' : r.ok ? 'OK' : 'Error: ' + r.error; });
    $('#poll').addEventListener('click', async () => { const r = await sapi('/baneco/poll', { method: 'POST' }); toast(`Consultadas ${r.checked}, acreditadas ${r.paid || 0}`); });
  });
})();
