// baneco.js — cliente "BEC QR CONNECT" (Api Market Baneco v1.3.0) sin dependencias.
// Config 100% por env: BANECO_BASE_URL, BANECO_USER, BANECO_PASSWORD, BANECO_AES_KEY (32 chars), BANECO_ACCOUNT.
// Si falta alguna variable, isConfigured() = false y el LMS trabaja en modo "manual" (QR estático + comprobante).
const crypto = require('crypto');

const cfg = () => ({
  base: (process.env.BANECO_BASE_URL || 'https://apimkt.baneco.com.bo/ApiGateway/').replace(/\/?$/, '/'),
  user: process.env.BANECO_USER || '',
  password: process.env.BANECO_PASSWORD || '',
  aesKey: process.env.BANECO_AES_KEY || '',
  account: process.env.BANECO_ACCOUNT || '',
  branch: process.env.BANECO_BRANCH || 'E0001',
});

function isConfigured() {
  const c = cfg();
  return !!(c.user && c.password && c.aesKey && c.account);
}

// AES-256-CBC, PKCS7, IV aleatorio de 16 bytes antepuesto, salida base64. Llave = 32 chars UTF-8.
function encrypt(plain) {
  const key = Buffer.from(cfg().aesKey, 'utf8');
  if (key.length !== 32) throw new Error('BANECO_AES_KEY debe tener exactamente 32 caracteres');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, enc]).toString('base64');
}

function decrypt(b64) {
  const key = Buffer.from(cfg().aesKey, 'utf8');
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

let tokenCache = { token: null, exp: 0 };

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const c = cfg();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth) headers.Authorization = `Bearer ${await getToken()}`;
  const res = await fetch(c.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Baneco ${path} HTTP ${res.status}: ${json.message || text.slice(0, 200)}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp - now > 5 * 60 * 1000) return tokenCache.token; // renovar 5 min antes
  const c = cfg();
  // Un solo intento: un login fallido repetido bloquea el usuario API (se desbloquea en agencia)
  const r = await call('api/authentication/authenticate', {
    method: 'POST', auth: false,
    body: { userName: c.user, password: encrypt(c.password) },
  });
  const token = r.token || r.accessToken || (r.data && r.data.token);
  if (!token) throw new Error('Baneco: respuesta de authenticate sin token');
  tokenCache = { token, exp: now + 25 * 60 * 1000 }; // el banco dice ~30 min; guardamos 25
  return token;
}

/**
 * Genera un QR dinámico.
 * @returns {Promise<{qrId:string, qrImage:string}>} qrImage = PNG base64
 */
async function generateQR({ transactionId, amount, description, dueDate, currency = 'BOB', singleUse = true, modifyAmount = false }) {
  const c = cfg();
  const r = await call('api/qrsimple/generateQR', {
    method: 'POST',
    body: {
      transactionId: String(transactionId).slice(0, 30),
      accountCredit: encrypt(c.account),
      currency,
      amount: Number(Number(amount).toFixed(2)),
      description: String(description || 'Pago').slice(0, 100),
      dueDate, // yyyy-MM-dd
      singleUse,
      modifyAmount,
      branchCode: c.branch,
    },
  });
  if (r.responseCode !== undefined && Number(r.responseCode) !== 0) {
    throw new Error(`Baneco generateQR responseCode ${r.responseCode}: ${r.message || ''}`);
  }
  return { qrId: String(r.qrId), qrImage: r.qrImage, raw: r };
}

/** statusQrCode: 0 activo/pendiente, 1 pagado, 9 anulado */
async function statusQR(qrId) {
  const r = await call(`api/qrsimple/v2/statusQR/${encodeURIComponent(qrId)}`);
  const code = Number(r.statusQrCode ?? (r.data && r.data.statusQrCode));
  return { code, paid: code === 1, cancelled: code === 9, payments: r.payment || r.payments || [], raw: r };
}

async function cancelQR(qrId) {
  return call('api/qrsimple/cancelQR', { method: 'DELETE', body: { qrId } });
}

/** Conciliación: QRs pagados en un día (yyyyMMdd) */
async function paidQR(yyyymmdd) {
  return call(`api/qrsimple/v2/paidQR/${yyyymmdd}`);
}

async function health() {
  if (!isConfigured()) return { configured: false };
  try { await getToken(); return { configured: true, ok: true }; }
  catch (e) { return { configured: true, ok: false, error: e.message }; }
}

module.exports = { isConfigured, encrypt, decrypt, generateQR, statusQR, cancelQR, paidQR, health };
