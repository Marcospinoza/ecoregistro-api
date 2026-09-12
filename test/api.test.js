const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { crearApp } = require('../server');
const { crearPool } = require('../db');

process.env.JWT_SECRET = randomBytes(32).toString('hex');
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const token = id => jwt.sign({}, process.env.JWT_SECRET, {subject:id, algorithm:'HS256',
    issuer:'ecoregistro-api', audience:'ecoregistro-app', expiresIn:'1h'});

test('Configuración de conexión y proxy', async () => {
    assert.throws(() => crearPool({NODE_ENV:'production'}), /DATABASE_URL/);
    const pool = crearPool({DATABASE_URL:'postgresql://demo:demo@localhost:5432/prueba'});
    assert.equal(pool.options.connectionString,'postgresql://demo:demo@localhost:5432/prueba');
    await pool.end();
    assert.throws(() => crearApp({}, {TRUST_PROXY_HOPS:'true'}), /TRUST_PROXY_HOPS/);
});

test('HTTP real con PostgreSQL simulado: login, aislamiento y reintentos', async t => {
    const rows = new Map();
    const password = randomBytes(16).toString('hex');
    const hash = await bcrypt.hash(password, 4);
    let romperDB = false;
    const pool = {query:async (sql, args) => {
        if (romperDB) throw new Error('Base simulada no disponible');
        if (sql.includes('current_database')) return {rows:[{base_datos:'prueba'}]};
        if (sql.includes('password_hash')) return {rows:args[0]==='marco'
            ? [{id:idA, nombre:'Marco',usuario:'marco',password_hash:hash,activo:true}] : []};
        if (sql.includes('activo = TRUE')) return {rowCount:1,rows:[{id:args[0]}]};
        if (sql.includes('INSERT INTO')) {
            if (rows.has(args[0])) return {rowCount:0,rows:[]};
            rows.set(args[0], [...args]);
            return {rowCount:1,rows:[{id:'1',uuid:args[0]}]};
        }
        if (sql.includes('AS coincide')) {
            assert.match(sql,/WHERE uuid = \$1 AND usuario_id = \$9/);
            const existing=rows.get(args[0]);
            return {rows:existing && existing[8]===args[8]
                ? [{id:'1',uuid:args[0],coincide:JSON.stringify(existing)===JSON.stringify(args)}] : []};
        }
        assert.match(sql,/WHERE usuario_id = \$1/);
        return {rows:[...rows.values()].filter(r=>r[8]===args[0]).map(r=>({uuid:r[0]}))};
    }};
    const app = crearApp(pool,{TRUST_PROXY_HOPS:'1'});
    assert.equal(app.get('trust proxy'),1);
    const server = app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, auth, body) => fetch(base+path, {
        method: body===undefined ? 'GET':'POST',
        headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
    });
    await t.test('salud y ruta sin token', async()=>{
        assert.equal((await request('/api/salud')).status,200);
        assert.equal((await request('/api/recolecciones')).status,401);
    });
    await t.test('login correcto e incorrecto', async()=>{
        assert.equal((await request('/api/auth/login',null,{usuario:'marco',password:'incorrecta'})).status,401);
        const response = await request('/api/auth/login',null,{usuario:'marco',password});
        assert.equal(response.status,200);
        assert.equal((await response.json()).usuario.id,idA);
    });
    const registro={uuid:'33333333-3333-4333-8333-333333333333',responsable:'Prueba',zona:'Oficina',
        tipo_residuo:'Vidrio',cantidad:2,unidad:'kg',fecha_registro:1234567890};
    await t.test('201, reenvío 200, cambio 409 y otra cuenta 409', async()=>{
        assert.equal((await request('/api/recolecciones',token(idA),registro)).status,201);
        assert.equal((await request('/api/recolecciones',token(idA),registro)).status,200);
        assert.equal((await request('/api/recolecciones',token(idA),{...registro,cantidad:3})).status,409);
        assert.equal((await request('/api/recolecciones',token(idB),registro)).status,409);
        const response = await request('/api/recolecciones',token(idB));
        assert.equal((await response.json()).cantidad,0);
    });
    await t.test('token vencido, JSON inválido y caída de DB', async()=>{
        const expired=jwt.sign({},process.env.JWT_SECRET,{subject:idA,issuer:'ecoregistro-api',audience:'ecoregistro-app',expiresIn:-1});
        assert.equal((await request('/api/recolecciones',expired)).status,401);
        const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
        assert.equal(bad.status,400);
        assert.equal((await bad.json()).ok,false);
        romperDB=true;
        assert.equal((await request('/api/salud')).status,503);
    });
});
