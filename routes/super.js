// routes/super.js — panel superadmin de plataforma (SG): tenants, soporte en vivo, estado global
const express = require('express');
const crypto = require('crypto');
const { q, getSettings, setSettings, invalidateTenants } = require('../db');
const auth = require('../auth');
const baneco = require('../baneco');
const payments = require('../payments');
const live = require('../live');

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

router.post('/login', wrap(async (req, res) => {
  const t = (req.body && req.body.token) || '';
  if (!process.env.SUPERADMIN_TOKEN) return res.status(500).json({ error: 'Falta SUPERADMIN_TOKEN en el servidor' });
  if (!t || t !== process.env.SUPERADMIN_TOKEN) return res.status(401).json({ error: 'Token incorrecto' });
  res.json({ token: auth.superSign() });
}));

router.use(auth.requireSuper);

const TENANT_STATS = `
  (SELECT count(*) FROM courses c WHERE c.tenant_id=t.id)::int AS courses,
  (SELECT count(*) FROM users u WHERE u.tenant_id=t.id AND u.role='student')::int AS students,
  (SELECT count(*) FROM users u WHERE u.tenant_id=t.id AND u.role='admin')::int AS admins,
  (SELECT coalesce(sum(o.amount_bs),0) FROM orders o JOIN courses c ON c.id=o.course_id WHERE c.tenant_id=t.id AND o.status='paid')::numeric AS sales_total,
  (SELECT coalesce(sum(o.amount_bs),0) FROM orders o JOIN courses c ON c.id=o.course_id WHERE c.tenant_id=t.id AND o.status='paid' AND o.paid_at >= date_trunc('month', now()))::numeric AS sales_month,
  (SELECT count(*) FROM orders o JOIN courses c ON c.id=o.course_id WHERE c.tenant_id=t.id AND o.status='pending')::int AS pending_orders,
  (SELECT count(*) FROM support_sessions s WHERE s.tenant_id=t.id AND s.status='open')::int AS open_support,
  (SELECT max(o.created_at) FROM orders o JOIN courses c ON c.id=o.course_id WHERE c.tenant_id=t.id) AS last_order_at`;

router.get('/overview', wrap(async (req, res) => {
  const one = async sql => (await q(sql)).rows[0];
  res.json({
    version: require('../package.json').version,
    tenants: Number((await one('SELECT count(*) c FROM tenants')).c),
    active: Number((await one("SELECT count(*) c FROM tenants WHERE status='active'")).c),
    students: Number((await one("SELECT count(*) c FROM users WHERE role='student'")).c),
    courses: Number((await one('SELECT count(*) c FROM courses')).c),
    sales_month: Number((await one("SELECT coalesce(sum(amount_bs),0) s FROM orders WHERE status='paid' AND paid_at >= date_trunc('month', now())")).s),
    sales_total: Number((await one("SELECT coalesce(sum(amount_bs),0) s FROM orders WHERE status='paid'")).s),
    pending_orders: Number((await one("SELECT count(*) c FROM orders WHERE status='pending'")).c),
    open_support: Number((await one("SELECT count(*) c FROM support_sessions WHERE status='open'")).c),
    integrations: { baneco: baneco.isConfigured(), jitsi: live.jitsiProvider(), jitsi_domain: process.env.JITSI_DOMAIN || null, stream: live.streamReady(), live_domain: live.LIVE().domain || null, jaas: live.jaasReady(), bunny: !!process.env.BUNNY_LIBRARY_ID, cloudflare_live: !!process.env.CF_STREAM_CUSTOMER_CODE },
    db: (await one('SELECT pg_size_pretty(pg_database_size(current_database())) s')).s,
  });
}));

router.get('/tenants', wrap(async (req, res) => {
  const { rows } = await q(`SELECT t.*, ${TENANT_STATS} FROM tenants t ORDER BY t.id`);
  res.json(rows);
}));

router.post('/tenants', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Nombre obligatorio' });
  const slug = slugify(b.slug || b.name);
  if (!slug) return res.status(400).json({ error: 'Slug inválido' });
  const dup = await q('SELECT 1 FROM tenants WHERE slug=$1', [slug]);
  if (dup.rows.length) return res.status(409).json({ error: 'Ese slug ya existe' });
  const t = (await q('INSERT INTO tenants(slug,name,domain,status,plan,monthly_fee_bs,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [slug, b.name, b.domain ? String(b.domain).toLowerCase().trim() : null, b.status || 'trial', b.plan || 'base', Number(b.monthly_fee_bs) || 0, b.notes || null])).rows[0];
  await setSettings({ brand_name: b.name, brand_tagline: b.tagline || 'Cursos online con certificado', support_whatsapp: b.support_whatsapp || '' }, t.id);
  let admin = null, password = null;
  if (b.admin_email) {
    password = b.admin_password || crypto.randomBytes(5).toString('base64url');
    admin = (await q('INSERT INTO users(email,password_hash,name,role,tenant_id) VALUES($1,$2,$3,$4,$5) RETURNING id,email,name',
      [String(b.admin_email).toLowerCase().trim(), await auth.hash(password), b.admin_name || 'Administrador', 'admin', t.id])).rows[0];
  }
  invalidateTenants();
  res.json({ tenant: t, admin, password });
}));

router.put('/tenants/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const F = ['name', 'domain', 'status', 'plan', 'monthly_fee_bs', 'billing_next_due', 'notes'];
  const sets = [], vals = [req.params.id];
  for (const f of F) if (b[f] !== undefined) { vals.push(b[f] === '' ? null : (f === 'domain' ? String(b[f]).toLowerCase().trim() : b[f])); sets.push(`${f}=$${vals.length}`); }
  if (b.slug && Number(req.params.id) !== 1) { vals.push(slugify(b.slug)); sets.push(`slug=$${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  const { rows } = await q(`UPDATE tenants SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
  invalidateTenants();
  res.json(rows[0]);
}));

router.delete('/tenants/:id', wrap(async (req, res) => {
  if (Number(req.params.id) === 1) return res.status(400).json({ error: 'El tenant 1 no se puede borrar' });
  await q('DELETE FROM tenants WHERE id=$1', [req.params.id]);
  invalidateTenants();
  res.json({ ok: true });
}));

router.get('/tenants/:id', wrap(async (req, res) => {
  const t = (await q(`SELECT t.*, ${TENANT_STATS} FROM tenants t WHERE t.id=$1`, [req.params.id])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tenant no encontrado' });
  const admins = (await q("SELECT id,name,email,created_at FROM users WHERE tenant_id=$1 AND role='admin' ORDER BY id", [t.id])).rows;
  const courses = (await q(`SELECT c.id,c.title,c.slug,c.price_bs,c.published,(SELECT count(*) FROM enrollments e WHERE e.course_id=c.id)::int AS students,
      (SELECT count(*) FROM orders o WHERE o.course_id=c.id AND o.status='paid')::int AS sales FROM courses c WHERE c.tenant_id=$1 ORDER BY c.id`, [t.id])).rows;
  const orders = (await q(`SELECT o.id,o.amount_bs,o.method,o.status,o.created_at,o.paid_at,u.name,c.title FROM orders o JOIN users u ON u.id=o.user_id JOIN courses c ON c.id=o.course_id WHERE c.tenant_id=$1 ORDER BY o.id DESC LIMIT 20`, [t.id])).rows;
  const support = (await q('SELECT * FROM support_sessions WHERE tenant_id=$1 ORDER BY id DESC LIMIT 10', [t.id])).rows;
  res.json({ tenant: t, admins, courses, orders, support, settings: await getSettings(t.id) });
}));

router.post('/tenants/:id/admins', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.email) return res.status(400).json({ error: 'Email obligatorio' });
  const password = b.password || crypto.randomBytes(5).toString('base64url');
  const { rows } = await q(`INSERT INTO users(email,password_hash,name,role,tenant_id) VALUES($1,$2,$3,'admin',$4)
    ON CONFLICT (tenant_id, lower(email)) DO UPDATE SET role='admin', password_hash=EXCLUDED.password_hash RETURNING id,email,name`,
    [String(b.email).toLowerCase().trim(), await auth.hash(password), b.name || 'Administrador', req.params.id]);
  res.json({ admin: rows[0], password });
}));

// Entrar al panel del tenant como su admin (token de tenant)
router.post('/tenants/:id/impersonate', wrap(async (req, res) => {
  const t = (await q('SELECT * FROM tenants WHERE id=$1', [req.params.id])).rows[0];
  if (!t) return res.status(404).json({ error: 'Tenant no encontrado' });
  let u = (await q("SELECT * FROM users WHERE tenant_id=$1 AND role='admin' ORDER BY id LIMIT 1", [t.id])).rows[0];
  if (!u) {
    u = (await q("INSERT INTO users(email,password_hash,name,role,tenant_id) VALUES($1,$2,'Soporte SG','admin',$3) RETURNING *",
      [`soporte+${t.slug}@sg-academia.local`, await auth.hash(crypto.randomBytes(12).toString('hex')), t.id])).rows[0];
  }
  res.json({ token: auth.sign(u), slug: t.slug, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

router.put('/tenants/:id/settings', wrap(async (req, res) => { await setSettings(req.body || {}, Number(req.params.id)); res.json(await getSettings(Number(req.params.id))); }));

// ---------- Soporte en vivo ----------
router.get('/support', wrap(async (req, res) => {
  const { rows } = await q(`SELECT s.*, t.name AS tenant_name, t.slug, u.name AS requester, u.email AS requester_email
    FROM support_sessions s JOIN tenants t ON t.id=s.tenant_id LEFT JOIN users u ON u.id=s.requested_by ORDER BY (s.status='open') DESC, s.id DESC LIMIT 50`);
  res.json(rows);
}));
router.post('/support/:id/join', wrap(async (req, res) => {
  const s = (await q('SELECT s.*, t.name AS tenant_name FROM support_sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  const me = { id: 'sg-support', name: 'Soporte SG', email: 'soporte@sg-bolivia.com' };
  res.json({ session: s, join: live.joinPayload({ mode: 'jitsi', room_name: s.room_name, title: `Soporte · ${s.tenant_name}` }, me, true, req.get('host')) });
}));
router.post('/support/:id/close', wrap(async (req, res) => {
  await q("UPDATE support_sessions SET status='closed', closed_at=now() WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Sistema ----------
router.get('/baneco/health', wrap(async (req, res) => res.json(await baneco.health())));
router.post('/baneco/poll', wrap(async (req, res) => res.json(await payments.pollPending())));
router.get('/orders', wrap(async (req, res) => {
  const { rows } = await q(`SELECT o.id,o.amount_bs,o.method,o.status,o.created_at,o.paid_at,u.name,u.email,c.title,t.name AS tenant_name
    FROM orders o JOIN users u ON u.id=o.user_id JOIN courses c ON c.id=o.course_id JOIN tenants t ON t.id=c.tenant_id ORDER BY o.id DESC LIMIT 100`);
  res.json(rows);
}));

module.exports = router;
