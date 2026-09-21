// auth.js — JWT + bcrypt + middlewares
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { q } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar';
const TTL = '30d';

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, SECRET, { expiresIn: TTL });
}

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

// Carga req.user si hay token válido; no bloquea
function optionalAuth(req, _res, next) {
  const t = tokenFrom(req);
  if (!t) return next();
  try { req.user = jwt.verify(t, SECRET); } catch (_) { /* token inválido = anónimo */ }
  next();
}

function requireAuth(req, res, next) {
  const t = tokenFrom(req);
  if (!t) return res.status(401).json({ error: 'Iniciá sesión' });
  try { req.user = jwt.verify(t, SECRET); return next(); }
  catch (_) { return res.status(401).json({ error: 'Sesión vencida, volvé a entrar' }); }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
    next();
  });
}

async function hash(pw) { return bcrypt.hash(pw, 10); }
async function verify(pw, h) { return bcrypt.compare(pw, h); }

// Crea el admin inicial desde env si no existe ningún admin
async function ensureAdmin() {
  const { rows } = await q("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (rows.length) return null;
  const email = (process.env.ADMIN_EMAIL || 'admin@sg-academia.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  await q('INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET role=$4',
    [email, await hash(password), process.env.ADMIN_NAME || 'Administrador', 'admin']);
  console.log(`[auth] admin inicial creado: ${email}`);
  return email;
}

module.exports = { sign, optionalAuth, requireAuth, requireAdmin, hash, verify, ensureAdmin };
