// db.js — pool de Postgres + migraciones idempotentes (corren al arrancar)
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://academia:academia@localhost:5432/academia';
const needsSsl = /railway|rlwy|neon|render|amazonaws/.test(connectionString) && !/localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 8,
});

const q = (text, params) => pool.query(text, params);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'student', -- student | admin
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  cover_url TEXT,
  price_bs NUMERIC(10,2) NOT NULL DEFAULT 0,
  instructor TEXT,
  hours NUMERIC(6,1),
  published BOOLEAN NOT NULL DEFAULT false,
  passing_score INT NOT NULL DEFAULT 70,
  require_all_lessons BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  section_id INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video', -- video | text | pdf
  provider TEXT DEFAULT 'youtube',      -- bunny | youtube | vimeo | url
  video_ref TEXT,                        -- id de Bunny / id de YouTube / id de Vimeo / URL mp4
  content TEXT,                          -- texto/markdown simple o URL de PDF
  duration_min INT DEFAULT 0,
  is_preview BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quizzes (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Examen final',
  max_attempts INT NOT NULL DEFAULT 3,
  time_limit_min INT DEFAULT 0,
  shuffle BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (course_id)
);
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'single', -- single | multiple | truefalse
  options JSONB NOT NULL DEFAULT '[]',  -- ["opción A", "opción B", ...]
  correct JSONB NOT NULL DEFAULT '[]',  -- índices correctos [0] o [0,2]
  explanation TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual', -- qr_baneco | manual | free | admin
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  seconds INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}',
  score INT NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS certificates (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  score INT,
  issued_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  amount_bs NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'qr_baneco', -- qr_baneco | manual
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | cancelled | expired
  qr_id TEXT,
  qr_image TEXT,          -- PNG base64 del banco
  qr_due_date DATE,
  receipt_mime TEXT,
  receipt BYTEA,          -- comprobante subido (modo manual)
  receipt_note TEXT,
  paid_at TIMESTAMPTZ,
  paid_by TEXT,           -- baneco | admin
  payment_info JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_qr ON orders(qr_id);
CREATE INDEX IF NOT EXISTS idx_lessons_section ON lessons(section_id);
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
`;

async function migrate() {
  await q(SCHEMA);
  const defaults = {
    brand_name: 'SG Academia',
    brand_tagline: 'Cursos online con certificado',
    currency: 'Bs',
    support_whatsapp: '',
    manual_qr_image: '',     // data URL / URL de un QR estático (modo manual)
    manual_instructions: 'Pagá con el QR y subí tu comprobante. Activamos tu acceso al verificarlo.',
    certificate_signer: 'Dirección Académica',
    certificate_footer: '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
}

async function getSettings() {
  const { rows } = await q('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v == null ? '' : String(v)]);
  }
}

module.exports = { pool, q, migrate, getSettings, setSettings };
