// seed.js — curso demo para probar el flujo completo (solo si no hay cursos)
const { q } = require('./db');

async function demo() {
  const { rows } = await q('SELECT count(*)::int c FROM courses');
  if (rows[0].c > 0) return;
  const c = (await q(`INSERT INTO courses(slug,title,subtitle,description,cover_url,price_bs,instructor,hours,published,passing_score)
    VALUES('curso-demo','Curso demo: Primeros auxilios básicos','Reconocé emergencias y actuá con seguridad',
    'Curso de demostración de SG Academia. Incluye lecciones en video, un examen final y certificado verificable. Reemplazalo o editalo desde el panel de administración.',
    'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=900&q=70', 150, 'Dr. Demo', 4, true, 70) RETURNING id`)).rows[0];
  const s1 = (await q("INSERT INTO sections(course_id,title,sort_order) VALUES($1,'Módulo 1 · Introducción',0) RETURNING id", [c.id])).rows[0];
  const s2 = (await q("INSERT INTO sections(course_id,title,sort_order) VALUES($1,'Módulo 2 · Práctica',1) RETURNING id", [c.id])).rows[0];
  await q(`INSERT INTO lessons(section_id,title,kind,provider,video_ref,duration_min,is_preview,sort_order) VALUES
    ($1,'Bienvenida y objetivos del curso','video','youtube','ysz5S6PUM-U',3,true,0),
    ($1,'Cadena de supervivencia','video','youtube','aqz-KE-bpKQ',8,false,1),
    ($2,'RCP paso a paso','video','youtube','ysz5S6PUM-U',12,false,0),
    ($2,'Material de lectura','text',NULL,NULL,5,false,1)`, [s1.id, s2.id]);
  await q(`UPDATE lessons SET content='## Resumen del módulo\n\nEsta es una lección de texto. Podés usar **negritas**, listas y enlaces.\n\n- Punto uno\n- Punto dos\n\nAl terminar, marcá la lección como completada.' WHERE kind='text'`);
  const quiz = (await q("INSERT INTO quizzes(course_id,title,max_attempts) VALUES($1,'Examen final',3) RETURNING id", [c.id])).rows[0];
  await q(`INSERT INTO questions(quiz_id,text,kind,options,correct,explanation,sort_order) VALUES
    ($1,'¿Cuál es el primer paso ante una emergencia?','single','["Iniciar RCP inmediatamente","Asegurar la escena","Llamar a un familiar"]','[1]','Antes de actuar hay que asegurarse de que la escena sea segura.',0),
    ($1,'La frecuencia recomendada de compresiones es de 100 a 120 por minuto.','truefalse','["Verdadero","Falso"]','[0]',NULL,1),
    ($1,'Seleccioná los signos de un paro cardíaco.','multiple','["Ausencia de respuesta","Respiración normal","Ausencia de respiración o jadeo","Dolor de cabeza leve"]','[0,2]',NULL,2)`, [quiz.id]);
  console.log('[seed] curso demo creado');
}

module.exports = { demo };
