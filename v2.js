const express = require('express');
const bcrypt = require('bcryptjs');
const {rateLimit} = require('express-rate-limit');
const verificar = require('./verificar-sesion');
const tipos = ['Papel y cartón','Plástico','Vidrio','Metal','Orgánicos','No aprovechables'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registro(pool) {
 const router = express.Router();
 router.post('/registro', rateLimit({windowMs:3600000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,
  message:{ok:false,mensaje:'Demasiadas solicitudes. Intenta más tarde.'}}), async(req,res)=>{
  const b=req.body;
  if (!b || typeof b!=='object' || Array.isArray(b) || typeof b.nombre!=='string' ||
      typeof b.usuario!=='string' || typeof b.password!=='string' ||
      !b.nombre.trim() || b.nombre.trim().length>100 || !/^[a-z0-9_]{3,30}$/.test(b.usuario.trim().toLowerCase()) ||
      b.password.length<12 || Buffer.byteLength(b.password,'utf8')>72) {
   return res.status(400).json({ok:false,mensaje:'Nombre: 1–100 caracteres. Usuario: 3–30 letras, números o _. Contraseña: mínimo 12 caracteres y máximo 72 bytes.'});
  }
  if ('rol' in b || 'activo' in b || 'id' in b) return res.status(400).json({ok:false,mensaje:'El registro público solo crea recolectores; no admite permisos.'});
  try {
   const hash=await bcrypt.hash(b.password,12);
   const r=await pool.query(`INSERT INTO public.usuarios (nombre,usuario,password_hash,rol)
     VALUES ($1,$2,$3,'recolector') ON CONFLICT (usuario) DO NOTHING RETURNING id, nombre, usuario, rol`,
    [b.nombre.trim(),b.usuario.trim().toLowerCase(),hash]);
   if(!r.rowCount) return res.status(409).json({ok:false,mensaje:'Ese nombre de usuario ya está registrado.'});
   res.status(201).json({ok:true,mensaje:'Cuenta creada. Ya puedes iniciar sesión.',usuario:r.rows[0]});
  } catch(e){ console.error('Registro:',e.message); res.status(500).json({ok:false,mensaje:'No se pudo crear la cuenta.'}); }
 });
 return router;
}
function entero(value, fallback, max=Number.MAX_SAFE_INTEGER) {
 if(value===undefined) return fallback;
 if(typeof value!=='string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) throw Error('Número inválido');
 return Number(value);
}
function filtros(q,id) {
 const vals=[]; const clauses=[];
 const add=(sql,v)=>{vals.push(v);clauses.push(sql.replace('?',`$${vals.length}`));};
 if(id) add('r.usuario_id = ?',id);
 const desde=entero(q.desde,null), hasta=entero(q.hasta,null);
 if(desde!==null && hasta!==null && desde>=hasta) throw Error('Rango de fechas inválido');
 if(desde!==null) add('r.fecha_registro >= ?',desde);
 if(hasta!==null) add('r.fecha_registro < ?',hasta);
 if(q.tipo!==undefined){if(!tipos.includes(q.tipo)) throw Error('Tipo inválido');add('r.tipo_residuo = ?',q.tipo);}
 if(q.unidad!==undefined){if(!['kg','L'].includes(q.unidad)) throw Error('Unidad inválida');add('r.unidad = ?',q.unidad);}
 if(q.zona!==undefined){if(typeof q.zona!=='string'||q.zona.length>100) throw Error('Zona inválida');add("strpos(lower(r.zona), lower(?)) > 0",q.zona);}
 return {vals,clauses};
}
function rutas(pool){
 const router=express.Router();router.use(verificar(pool));
 const admin=(req,res,next)=>req.rol==='administrador'?next():res.status(403).json({ok:false,mensaje:'Acceso exclusivo del administrador.'});
 router.get('/admin/usuarios',admin,async(req,res)=>{
  try{const r=await pool.query('SELECT id,nombre,usuario,rol,activo FROM public.usuarios ORDER BY nombre, id');
   res.json({ok:true,usuarios:r.rows});
  }catch(e){res.status(500).json({ok:false,mensaje:'No se pudieron cargar los usuarios.'});}
 });
 async function listar(req,res,general){
  try{
   let propietario=req.usuarioId;
   if(general){propietario=req.query.usuario_id;
    if(propietario!==undefined && (typeof propietario!=='string'||!uuid.test(propietario))) throw Error('Usuario inválido');
   } else if(req.query.usuario_id!==undefined) throw Error('No se permite seleccionar otra cuenta');
   const {vals,clauses}=filtros(req.query,propietario);
   // IDs bigint conservados como texto. Nunca convertirlos a Number.
   const idVal=(v)=>typeof v==='string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v)<=9223372036854775807n;
   const after=req.query.despues||'0'; if(!idVal(after)) throw Error('Cursor inválido');
   let techo=req.query.limite_id;
   if(techo!==undefined && !idVal(techo)) throw Error('Límite inválido');
   const limite=entero(req.query.limite,200,500);if(limite<1) throw Error('Límite inválido');
   if(techo===undefined){
    const m=await pool.query(`SELECT COALESCE(MAX(r.id),0)::text AS max_id FROM public.recolecciones r ${clauses.length?'WHERE '+clauses.join(' AND '):''}`,vals);
    techo=m.rows[0].max_id;
   }
   vals.push(after);clauses.push(`r.id > $${vals.length}`);vals.push(techo);clauses.push(`r.id <= $${vals.length}`);
   vals.push(limite+1);
   const r=await pool.query(`SELECT r.id::text, r.uuid, r.usuario_id, u.nombre AS cuenta_nombre, u.usuario AS cuenta_usuario,
    r.responsable,r.zona,r.tipo_residuo,r.cantidad::text,r.unidad,r.observaciones,r.fecha_registro::text
    FROM public.recolecciones r JOIN public.usuarios u ON u.id=r.usuario_id
    WHERE ${clauses.join(' AND ')} ORDER BY r.id ASC LIMIT $${vals.length}`,vals);
   const mas=r.rows.length>limite, rows=r.rows.slice(0,limite);
   res.json({ok:true,recolecciones:rows,cantidad:rows.length,limite_id:techo,
    siguiente:mas?rows[rows.length-1].id:null,fuente:'PostgreSQL'});
  }catch(e){
   if(!e.code && /inválid|permite/.test(e.message)) return res.status(400).json({ok:false,mensaje:e.message});
   console.error('Consulta v2:',e.message);res.status(500).json({ok:false,mensaje:'No se pudieron cargar las recolecciones.'});
  }
 }
 router.get('/recolecciones',(req,res)=>listar(req,res,false));
 router.get('/admin/recolecciones',admin,(req,res)=>listar(req,res,true));
 return router;
}
module.exports={registro,rutas,filtros};
