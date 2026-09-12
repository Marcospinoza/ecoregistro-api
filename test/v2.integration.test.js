const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const jwt=require('jsonwebtoken');
// npm install --no-save @electric-sql/pglite, o PGLITE_TEST_MODULE=/ruta/al/módulo.
let PGlite;
try { ({PGlite}=require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite')); } catch {}

test('V2: migración y permisos con motor PostgreSQL embebido', {skip:!PGlite}, async t=>{
 process.env.JWT_SECRET=randomBytes(32).toString('hex');
 const {crearApp}=require('../server');
 const db=new PGlite();
 await db.exec(`CREATE TABLE usuarios(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL, usuario text UNIQUE NOT NULL,password_hash text NOT NULL, activo boolean NOT NULL DEFAULT true);
 CREATE TABLE recolecciones(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,uuid uuid NOT NULL UNIQUE,usuario_id uuid NOT NULL REFERENCES usuarios(id),responsable text NOT NULL,zona text NOT NULL,tipo_residuo text NOT NULL,cantidad numeric NOT NULL,unidad text NOT NULL,observaciones text NOT NULL DEFAULT '',fecha_registro bigint NOT NULL,fecha_recepcion timestamptz DEFAULT now());`);
 const pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:/^\s*SELECT/i.test(sql)?r.rows.length:r.affectedRows};}};
 const legacy=randomUUID();await pool.query("INSERT INTO usuarios(id,nombre,usuario,password_hash) VALUES($1,'Anterior','anterior','hash')",[legacy]);
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/002_roles.sql'),'utf8');
 await db.exec(migration);await db.exec(migration);
 assert.equal((await db.query('SELECT rol FROM usuarios WHERE id=$1',[legacy])).rows[0].rol,'recolector');
 const server=crearApp(pool).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(route,auth,body)=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 let a,b,admin,ta,tb,tc;
 const password='Prueba-Solo-Test-123';
 await t.test('registro: validación, rol forzado, duplicado y hash',async()=>{
  assert.equal((await req('/api/auth/registro',null,{nombre:'A',usuario:'aa',password})).status,400);
  assert.equal((await req('/api/auth/registro',null,{nombre:'A',usuario:'aaa',password,rol:'administrador'})).status,400);
  let r=await req('/api/auth/registro',null,{nombre:'A',usuario:'usuario_a',password});assert.equal(r.status,201);a=r.body.usuario.id;assert.equal(r.body.usuario.rol,'recolector');assert.equal(r.body.usuario.password_hash,undefined);
  r=await req('/api/auth/registro',null,{nombre:'B',usuario:'usuario_b',password});b=r.body.usuario.id;
  assert.equal((await req('/api/auth/registro',null,{nombre:'A',usuario:' USUARIO_A ',password})).status,409);
  const row=(await db.query('SELECT password_hash FROM usuarios WHERE id=$1',[a])).rows[0];assert.notEqual(row.password_hash,password);
 });
 await t.test('login y administrador asignado solo en base de datos',async()=>{
  const r=await req('/api/auth/login',null,{usuario:'usuario_a',password});assert.equal(r.status,200);ta=r.body.token;assert.equal(r.body.usuario.rol,'recolector');
  tb=(await req('/api/auth/login',null,{usuario:'usuario_b',password})).body.token;
  admin=randomUUID();await pool.query("INSERT INTO usuarios(id,nombre,usuario,password_hash,rol) VALUES($1,'Admin','admin','no-login','administrador')",[admin]);
  tc=jwt.sign({},process.env.JWT_SECRET,{subject:admin,issuer:'ecoregistro-api',audience:'ecoregistro-app',expiresIn:'1h'});
  assert.equal((await req('/api/v2/admin/recolecciones',ta)).status,403);
  assert.equal((await req('/api/v2/admin/usuarios',tb)).status,403);
  assert.equal((await req('/api/v2/admin/recolecciones')).status,401);
 });
 const fecha=Date.parse('2026-09-12T00:00:00-05:00');
 const registro={uuid:randomUUID(),responsable:'A',zona:'Oficina',tipo_residuo:'Plástico',cantidad:1.25,unidad:'kg',fecha_registro:fecha,usuario_id:b};
 await t.test('guardado, idempotencia y rechazo de identidad enviada por cliente',async()=>{
  assert.equal((await req('/api/recolecciones',ta,registro)).status,201);
  assert.equal((await req('/api/recolecciones',ta,registro)).status,200);
  assert.equal((await req('/api/recolecciones',tb,registro)).status,409);
  assert.equal((await req('/api/v2/recolecciones',tb)).body.cantidad,0);
  assert.equal((await req('/api/v2/recolecciones?usuario_id='+a,tb)).status,400);
 });
 await t.test('paginación >100, sin duplicados y excluye altas posteriores al corte',async()=>{
  await db.query(`INSERT INTO recolecciones(uuid,usuario_id,responsable,zona,tipo_residuo,cantidad,unidad,fecha_registro)
   SELECT gen_random_uuid(),$1,'A','Zona % _','Vidrio',2,'L',$2 FROM generate_series(1,505)`,[a,fecha+1]);
  let r=await req('/api/v2/recolecciones?limite=200',ta);assert.equal(r.body.cantidad,200);let ids=new Set(r.body.recolecciones.map(x=>x.id));const techo=r.body.limite_id;
  await req('/api/recolecciones',ta,{...registro,uuid:randomUUID(),fecha_registro:fecha+86400000});
  while(r.body.siguiente){r=await req(`/api/v2/recolecciones?limite=200&despues=${r.body.siguiente}&limite_id=${techo}`,ta);assert.equal(r.status,200);for(const x of r.body.recolecciones){assert.equal(x.usuario_id,a);assert(!ids.has(x.id));ids.add(x.id);}}
  assert.equal(ids.size,506);
 });
 await t.test('filtros de día Perú, zona literal, tipo, unidad y recolector',async()=>{
  let r=await req(`/api/v2/admin/recolecciones?desde=${fecha}&hasta=${fecha+86400000}&tipo=${encodeURIComponent('Plástico')}&unidad=kg&usuario_id=${a}`,tc);
  assert.equal(r.status,200);assert.equal(r.body.cantidad,1);assert.equal(r.body.recolecciones[0].cantidad,'1.25');
  r=await req('/api/v2/admin/recolecciones?zona='+encodeURIComponent('% _')+'&limite=500',tc);assert.equal(r.body.cantidad,500);assert(r.body.siguiente);
  assert.equal((await req(`/api/v2/admin/recolecciones?usuario_id=${b}`,tc)).body.cantidad,0);
  for(const q of ['limite=0','limite=501','despues=-1','desde=abc','tipo=xx','unidad=g','desde=10&hasta=5','usuario_id=abc'])assert.equal((await req('/api/v2/admin/recolecciones?'+q,tc)).status,400,q);
 });
 await t.test('revocar rol y desactivar invalida permisos incluso con token anterior',async()=>{
  let r=await req('/api/v2/admin/usuarios',tc);assert.equal(r.status,200);assert(!JSON.stringify(r.body).includes('password_hash'));
  await db.query("UPDATE usuarios SET rol='recolector' WHERE id=$1",[admin]);assert.equal((await req('/api/v2/admin/recolecciones',tc)).status,403);
  await db.query('UPDATE usuarios SET activo=false WHERE id=$1',[a]);assert.equal((await req('/api/v2/recolecciones',ta)).status,401);
 });
});
