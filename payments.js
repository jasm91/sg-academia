// payments.js — órdenes de compra: QR Baneco (automático) o manual (QR estático + comprobante)
const { q } = require('./db');
const baneco = require('./baneco');

function todayBolivia(offsetDays = 0) {
  const d = new Date(Date.now() - 4 * 3600 * 1000 + offsetDays * 86400000); // UTC-4 sin DST
  return d.toISOString().slice(0, 10);
}

async function enroll(userId, courseId, source) {
  await q('INSERT INTO enrollments(user_id,course_id,source) VALUES($1,$2,$3) ON CONFLICT (user_id,course_id) DO NOTHING', [userId, courseId, source]);
}

/** Marca una orden como pagada e inscribe. Idempotente (solo si estaba pending). */
async function markPaid(orderId, by, info) {
  const { rows } = await q(
    `UPDATE orders SET status='paid', paid_at=now(), paid_by=$2, payment_info=$3
     WHERE id=$1 AND status='pending' RETURNING *`, [orderId, by, info ? JSON.stringify(info) : null]);
  if (!rows.length) return null;
  const o = rows[0];
  await enroll(o.user_id, o.course_id, o.method === 'qr_baneco' ? 'qr_baneco' : 'manual');
  return o;
}

/**
 * Crea (o reutiliza) la orden pendiente de un alumno para un curso.
 * Si Baneco está configurado genera QR dinámico; si no, orden manual.
 */
async function createOrder(user, course) {
  const pend = await q("SELECT * FROM orders WHERE user_id=$1 AND course_id=$2 AND status='pending' ORDER BY id DESC LIMIT 1", [user.id, course.id]);
  if (pend.rows.length) {
    const o = pend.rows[0];
    // Si es QR y venció, se marca expirada y se genera otra
    if (o.method === 'qr_baneco' && o.qr_due_date && String(o.qr_due_date).slice(0, 10) < todayBolivia()) {
      await q("UPDATE orders SET status='expired' WHERE id=$1", [o.id]);
    } else {
      return o;
    }
  }
  const amount = Number(course.price_bs);
  if (baneco.isConfigured()) {
    const ins = await q("INSERT INTO orders(user_id,course_id,amount_bs,method,status) VALUES($1,$2,$3,'qr_baneco','pending') RETURNING *", [user.id, course.id, amount]);
    const o = ins.rows[0];
    try {
      const due = todayBolivia(1);
      const r = await baneco.generateQR({
        transactionId: `SGA-${o.id}-${Date.now().toString(36)}`,
        amount,
        description: `Curso ${course.title}`.slice(0, 100),
        dueDate: due,
      });
      const up = await q('UPDATE orders SET qr_id=$2, qr_image=$3, qr_due_date=$4 WHERE id=$1 RETURNING *', [o.id, r.qrId, r.qrImage, due]);
      return up.rows[0];
    } catch (e) {
      // Si el banco falla, degradar a manual para no bloquear la venta
      console.error('[baneco] generateQR falló, degradando a manual:', e.message);
      const up = await q("UPDATE orders SET method='manual', payment_info=$2 WHERE id=$1 RETURNING *", [o.id, JSON.stringify({ baneco_error: e.message })]);
      return up.rows[0];
    }
  }
  const ins = await q("INSERT INTO orders(user_id,course_id,amount_bs,method,status) VALUES($1,$2,$3,'manual','pending') RETURNING *", [user.id, course.id, amount]);
  return ins.rows[0];
}

/** Consulta el banco por una orden QR pendiente y acredita si figura pagada. */
async function checkOrder(order) {
  if (order.status !== 'pending' || order.method !== 'qr_baneco' || !order.qr_id) return order;
  const st = await baneco.statusQR(order.qr_id);
  if (st.paid) {
    const o = await markPaid(order.id, 'baneco', { payments: st.payments });
    return o || (await q('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0];
  }
  if (st.cancelled) {
    const { rows } = await q("UPDATE orders SET status='cancelled' WHERE id=$1 AND status='pending' RETURNING *", [order.id]);
    return rows[0] || order;
  }
  return order;
}

/** Poller: recorre las órdenes QR pendientes (cron in-process) */
async function pollPending() {
  if (!baneco.isConfigured()) return { checked: 0 };
  const { rows } = await q("SELECT * FROM orders WHERE status='pending' AND method='qr_baneco' AND qr_id IS NOT NULL AND created_at > now() - interval '3 days' ORDER BY id");
  let paid = 0;
  for (const o of rows) {
    try { const r = await checkOrder(o); if (r.status === 'paid') paid++; }
    catch (e) { console.error('[poller] orden', o.id, e.message); }
  }
  // Expirar QRs vencidos
  await q("UPDATE orders SET status='expired' WHERE status='pending' AND method='qr_baneco' AND qr_due_date < $1", [todayBolivia()]);
  return { checked: rows.length, paid };
}

/** Conciliación del día contra paidQR del banco (red de seguridad) */
async function reconcileDay(yyyymmdd) {
  if (!baneco.isConfigured()) return { error: 'Baneco no configurado' };
  const r = await baneco.paidQR(yyyymmdd);
  const list = Array.isArray(r) ? r : (r.paidQRs || r.data || r.payments || []);
  let credited = 0;
  for (const p of list) {
    const qrId = String(p.qrId || p.QRId || '');
    if (!qrId) continue;
    const { rows } = await q("SELECT * FROM orders WHERE qr_id=$1 AND status='pending'", [qrId]);
    if (rows.length) { await markPaid(rows[0].id, 'baneco', { reconcile: p }); credited++; }
  }
  return { bankPaid: list.length, credited };
}

let timer = null;
function startPoller(minutes = 3) {
  if (timer) return;
  timer = setInterval(() => pollPending().then(r => { if (r.paid) console.log('[poller] acreditadas', r.paid); }).catch(e => console.error('[poller]', e.message)), minutes * 60 * 1000);
  console.log(`[poller] Baneco cada ${minutes} min (${baneco.isConfigured() ? 'activo' : 'inactivo: sin credenciales, modo manual'})`);
}

module.exports = { createOrder, checkOrder, markPaid, enroll, pollPending, reconcileDay, startPoller, todayBolivia };
