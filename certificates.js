// certificates.js — emisión y PDF de certificados con código de verificación + QR
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { q, getSettings } = require('./db');

function newCode() {
  // p.ej. SGA-7K3M-Q2ZX-9B
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para leer bien impreso
  const b = crypto.randomBytes(10);
  let raw = '';
  for (let i = 0; i < 10; i++) raw += A[b[i] % A.length];
  return `SGA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`;
}

async function issue(userId, courseId, score) {
  const existing = await q('SELECT * FROM certificates WHERE user_id=$1 AND course_id=$2', [userId, courseId]);
  if (existing.rows.length) return existing.rows[0];
  for (let i = 0; i < 5; i++) {
    try {
      const { rows } = await q('INSERT INTO certificates(code,user_id,course_id,score) VALUES($1,$2,$3,$4) RETURNING *', [newCode(), userId, courseId, score]);
      return rows[0];
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  throw new Error('No se pudo generar código único');
}

async function findByCode(code) {
  const { rows } = await q(`
    SELECT c.code, c.score, c.issued_at, u.name AS student, co.title AS course, co.hours, co.instructor, co.tenant_id
    FROM certificates c JOIN users u ON u.id=c.user_id JOIN courses co ON co.id=c.course_id
    WHERE upper(c.code)=upper($1)`, [code]);
  return rows[0] || null;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz' });
}

async function pdfStream(cert, baseUrl, tenantId) {
  const s = await getSettings(tenantId || cert.tenant_id || 1);
  const verifyUrl = `${baseUrl}/#/verificar/${cert.code}`;
  const qrPng = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220 });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const W = doc.page.width, H = doc.page.height;
  const teal = '#0e8a93', dark = '#1f2937', soft = '#e6f6f7';

  // Marco
  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.rect(24, 24, W - 48, H - 48).lineWidth(2).stroke(teal);
  doc.rect(32, 32, W - 64, H - 64).lineWidth(0.5).stroke('#9fd6da');
  doc.rect(24, 24, 18, H - 48).fill(teal);

  doc.fillColor(teal).font('Helvetica-Bold').fontSize(14).text((s.brand_name || 'SG Academia').toUpperCase(), 70, 60, { characterSpacing: 3 });
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(34).text('CERTIFICADO', 70, 110);
  doc.font('Helvetica').fontSize(14).fillColor('#4b5563').text('de finalización', 70, 150);

  doc.moveDown(2);
  doc.font('Helvetica').fontSize(13).fillColor('#374151').text('Se certifica que', 70, 200);
  doc.font('Helvetica-Bold').fontSize(28).fillColor(dark).text(cert.student, 70, 222, { width: W - 340 });
  doc.font('Helvetica').fontSize(13).fillColor('#374151').text('completó satisfactoriamente el curso', 70, 268);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(teal).text(cert.course, 70, 290, { width: W - 340 });

  const meta = [];
  if (cert.hours) meta.push(`Carga horaria: ${cert.hours} h`);
  if (cert.score != null) meta.push(`Calificación: ${cert.score}%`);
  meta.push(`Fecha: ${fmtDate(cert.issued_at)}`);
  doc.font('Helvetica').fontSize(11).fillColor('#4b5563').text(meta.join('   ·   '), 70, 345);

  // Firma
  doc.moveTo(70, H - 110).lineTo(300, H - 110).lineWidth(1).stroke('#9ca3af');
  doc.font('Helvetica-Bold').fontSize(11).fillColor(dark).text(s.certificate_signer || 'Dirección Académica', 70, H - 102);
  if (cert.instructor) doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text(`Instructor: ${cert.instructor}`, 70, H - 86);
  if (s.certificate_footer) doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(s.certificate_footer, 70, H - 66, { width: W - 340 });

  // QR + código
  doc.roundedRect(W - 260, H - 250, 200, 210, 10).fill(soft);
  doc.image(qrPng, W - 235, H - 240, { width: 150 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text(cert.code, W - 260, H - 82, { width: 200, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280').text('Verificá este certificado en ' + baseUrl.replace(/^https?:\/\//, '') + '/#/verificar', W - 260, H - 68, { width: 200, align: 'center' });

  doc.end();
  return doc;
}

module.exports = { issue, findByCode, pdfStream };
