# EcoRegistro API 2.0

API Express/PostgreSQL. Añade registro público de recolectores, roles comprobados en base de datos y consultas paginadas propias y administrativas.

1. Ejecutar `migrations/002_roles.sql` en la base existente antes de desplegar.
2. Configurar DATABASE_URL y JWT_SECRET (64 caracteres hexadecimales).
3. `npm ci` y `npm start`. En Render: TRUST_PROXY_HOPS=1 y NODE_ENV=production.
4. Seguir `LEEME_PRIMERO.md` del paquete completo para crear administrador e integrar Android.

## Rutas

| Ruta | Acceso |
|---|---|
| GET /api/salud | Salud pública |
| POST /api/auth/login | Credenciales |
| POST /api/auth/registro | Público; no admite rol, activo ni id |
| POST /api/recolecciones | Cuenta autenticada; propietario del token, UUID idempotente |
| GET /api/recolecciones | Compatibilidad v1; últimas 100 propias |
| GET /api/v2/recolecciones | Paginación y filtros, siempre propia cuenta |
| GET /api/v2/admin/recolecciones | Administrador; todas o por usuario_id |
| GET /api/v2/admin/usuarios | Administrador; sin hashes ni credenciales |

## Parámetros GET v2

- desde: timestamp en milisegundos incluido; hasta: timestamp excluido.
- tipo: tipo de residuo exacto; unidad: kg o L; zona: subcadena literal (insensible a mayúsculas).
- usuario_id: UUID del recolector, solo en ruta administrativa.
- limite: 1 a 500 (por defecto 200).
- despues: último ID recibido como texto decimal, inicialmente 0.
- limite_id: conservar el que devuelve la primera página para excluir nuevas altas con IDs superiores durante la lectura.
- siguiente: null cuando termina; de lo contrario, usarlo como despues en la siguiente petición y mantener idénticos filtros.

No hay rutas de edición ni eliminación de datos. Las consultas paginadas no abren una transacción PostgreSQL de larga duración entre peticiones. Los registros con transacciones concurrentes que aún no habían confirmado pueden verse en una actualización posterior.

## Pruebas

`npm test` ejecuta pruebas HTTP con un pool simulado. `npm install --no-save @electric-sql/pglite` habilita también las pruebas con motor PostgreSQL embebido; después ejecutar `npm test` y comprobar que no haya pruebas omitidas.

No se deben añadir contraseñas reales ni `.env` al repositorio. `crear-usuario.js` usa variables CREAR_* del `.env` local y admite CREAR_ROL=administrador. Un usuario existente no se modifica ni se promueve con ese comando.
