// server.js — SG Academia: API + SPA en un solo servicio (Railway)
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const payments = require('./payments');
const seed = require('./seed');

const APP_VERSION = require('./package.json').version;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Cabeceras básicas de seguridad (los iframes de video necesitan permitir terceros)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, version: APP_VERSION, time: new Date().toISOString() }));

// Tenant en cada request de API
app.use('/api', async (req, res, next) => {
  try { req.tenant = await db.resolveTenant(req); if (!req.tenant) return res.status(500).json({ error: 'Sin tenant' }); next(); }
  catch (e) { next(e); }
});
app.use('/api/hooks', require('./routes/hooks'));
app.use('/api/super', require('./routes/super'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// SPA
const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { maxAge: '1h', etag: true, index: false }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No existe' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(pub, 'index.html'));
});

// Errores
app.use((err, req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Archivo demasiado grande (máx. 4 MB)' });
  console.error('[error]', req.method, req.path, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err);
  res.status(err.status || 500).json({ error: (err && err.message) || 'Error interno' });
});

const PORT = process.env.PORT || 3000;

async function main() {
  await db.migrate();
  await auth.ensureAdmin();
  if (process.env.SEED_DEMO !== '0') await seed.demo();
  payments.startPoller(Number(process.env.BANECO_POLL_MINUTES) || 3);
  app.listen(PORT, () => console.log(`[sg-academia] v${APP_VERSION} escuchando en :${PORT}`));
}

if (require.main === module) {
  main().catch(e => { console.error('[fatal]', e); process.exit(1); });
}

module.exports = { app, main };
