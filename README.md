# EcoRegistro API — Preparación para Render

Paquete preparado el 12/09/2026. Código adaptado; no se ha publicado ni se ha
trasladado tu base de datos. No contiene contraseñas reales, cuentas ni registros.

## 1. Archivos para GitHub

Respalda tu proyecto local. Copia estos archivos sobre tu proyecto conservando
el `.env` privado de tu laptop. Sube a GitHub el contenido de `ecoregistro-api`,
con `package.json` en la raíz del repositorio. Incluye `test/` y `.node-version`.
No subas `.env`, `node_modules` ni respaldos de PostgreSQL.
Si el repositorio ya existe, actualiza sus archivos; no necesitas crear otro.

Con Node 24, en la carpeta del proyecto:

```sh
npm ci
npm test
npm run dev
```

`npm run dev` carga el `.env` local. `npm start` toma las variables del entorno,
como hace Render. Se conservó tu campo `main: index.js`; el arranque lo define
el script `start`, que ejecuta `server.js`.

## 2. Trasladar PostgreSQL sin perder los UUID

El ZIP recibido solo contiene JavaScript. La base está en PostgreSQL de tu laptop;
no se copia al subir el código. Usaremos un respaldo completo de esa base para
mantener tablas, restricciones, secuencias, cuentas, hashes y recolecciones.

En Render crea una base PostgreSQL vacía, nombre sugerido `ecoregistro-db`,
base `ecoregistro`, plan Free para tu demostración y la misma región que la API.
Escoge PostgreSQL 18, igual que tu servidor local, si está disponible. Si solo
ofrece una versión inferior, no ejecutes aún la restauración: hace falta revisar
compatibilidad. Una restauración hacia versiones anteriores no está garantizada.
Si ya creaste la base, utiliza esa y verifica que esté vacía.

En CMD de Windows, con PostgreSQL 18 instalado en su ruta habitual:

```bat
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -d ecoregistro -Fc -f "%USERPROFILE%\Desktop\ecoregistro.backup" -W
```

La contraseña se introduce en el aviso. Guarda ese respaldo fuera del repositorio.
Pausa los envíos a la API local mientras haces el traslado; los registros nuevos
pueden quedar pendientes en Android hasta que se active el servidor nuevo.

Para restaurar en la base NUEVA y VACÍA de Render, copia su hostname externo,
usuario y nombre de base desde Connect. Sustituye los tres valores de ejemplo:

```bat
set PGSSLMODE=require
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h HOST_EXTERNO_RENDER -p 5432 -U USUARIO_RENDER -d BASE_RENDER --no-owner --no-privileges --single-transaction -W "%USERPROFILE%\Desktop\ecoregistro.backup"
set PGSSLMODE=
```

Usa la contraseña de PostgreSQL de Render en el aviso. No marques opciones de
borrado ni restaures encima de una base con datos. Si falla, conserva el mensaje
para revisarlo; `--single-transaction` evita dejar una restauración parcial.

La cuenta Marco debe conservar el UUID
`bec94f06-6988-4174-a8b6-68d824d44a86`. Recrear una cuenta con el mismo nombre
pero otro UUID no recupera su asociación con los datos locales de Android.
Los registros que ya estaban sincronizados tampoco se vuelven a enviar solos:
por eso se trasladan los datos existentes, no solo las tablas.

Desde pgAdmin conectado a Render puedes comprobar:

```sql
SELECT id, nombre, usuario, activo FROM public.usuarios;
SELECT usuario_id, count(*) FROM public.recolecciones GROUP BY usuario_id;
```

Compara con la base original. También incluí `comprobar-db.js`: con un `.env`
local separado que contenga DATABASE_URL externa (TLS: sslmode=require), ejecuta
`npm run db:check`. Solo consulta columnas, cuentas y conteos; no modifica datos.

Referencias: [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## 3. Crear el Web Service

Conecta Render con tu repositorio de GitHub. Configura:

| Campo | Valor |
| --- | --- |
| Name | ecoregistro-api (o un nombre disponible) |
| Language | Node |
| Region | La misma que PostgreSQL |
| Root Directory | Vacío si package.json está en la raíz |
| Build Command | npm ci |
| Start Command | npm start |
| Instance Type | Free |
| Health Check Path | /api/salud |

Variables en Environment:

| Variable | Valor |
| --- | --- |
| NODE_ENV | production |
| DATABASE_URL | Internal Database URL de la base de Render |
| JWT_SECRET | Un secreto propio de 64 caracteres hexadecimales |
| TRUST_PROXY_HOPS | 1 |

No copies PGHOST=127.0.0.1 a Render. El código utiliza DATABASE_URL en ambos
scripts (API y creación de usuarios), o las variables PG* en desarrollo local.
Para la URL interna usa el valor que proporciona Render. Para conexiones desde
la laptop usa la URL externa con TLS; no desactives globalmente la verificación
de certificados para arreglar una conexión.

Genera JWT_SECRET en tu laptop con:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copia el resultado solo a Environment. Cambiar el secreto invalida tokens viejos:
se soluciona volviendo a iniciar sesión, sin cambiar cuentas ni contraseñas.
No agregues CREAR_PASSWORD al servicio web; crear usuarios es una operación manual.

El servidor escucha en `0.0.0.0` y usa el `PORT` asignado por Render.
`TRUST_PROXY_HOPS=1` confía en el proxy inmediato de entrada. Si luego añades
otro proxy/CDN, revisa la cadena antes de cambiar ese número; no uses `true`.
En local directo conserva 0. El límite de login existente sigue siendo por IP
(10 intentos/15 minutos); equipos de una misma red pueden compartirlo.

Referencias: [Web Services](https://render.com/docs/web-services),
[conexiones PostgreSQL](https://render.com/docs/postgresql-creating-connecting),
[Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies/).

## 4. Android y APK

Cuando el despliegue esté Live, abre la dirección HTTPS real seguida de
`/api/salud` y comprueba `ok: true`. Prueba login con Thunder Client antes del APK.
En Android cambia únicamente BASE_URL de ApiConfig.java por:

```java
public static final String BASE_URL = "https://NOMBRE_REAL.onrender.com";
```

No agregues :3000, /api ni /login a BASE_URL. El código añade las rutas.
HTTPS usa el permiso base de tu configuración de red; no requiere autorizar
HTTP para ese dominio. Este paquete no cambia tus archivos Android.

En el plan gratuito, el primer acceso después de inactividad puede tardar más
que el timeout actual de la app. Para la demostración abre /api/salud en el
navegador, espera a que responda y después inicia sesión. Si la API está dormida
y falla el primer intento, espera a que despierte antes de reintentar.

Prueba desde el teléfono con datos móviles: login, crear, sincronizar y consultar
con el token. Prueba también otra cuenta: no debe ver registros ajenos. El historial
Android sigue siendo local; no descarga los registros de otros dispositivos.

## 5. Alcance y límites

La prueba automatizada `npm test` abre un servidor HTTP local y usa PostgreSQL
simulado. Comprueba configuración, salud, login válido/incorrecto, ausencia y
caducidad del token, parámetros por propietario, alta/reenvío/conflictos, JSON
inválido y respuesta ante caída de BD. No sustituye probar PostgreSQL real,
la restauración, TLS, el proxy y los dispositivos en Render.

No se cambió el contrato JSON usado por la app ni se agregaron dependencias.
Se agregó configuración de puerto, conexión compartida, cierre ordenado y errores
JSON. El esquema se conserva mediante el respaldo; no se inventó un esquema nuevo.

Render Free apaga el servicio web tras 15 minutos sin tráfico y despertarlo tarda
aproximadamente un minuto. Su PostgreSQL Free vence a los 30 días; exporta un
respaldo antes del vencimiento. No es una base gratuita permanente. Consulta los
[límites oficiales de Render Free](https://render.com/docs/free) antes de crearlo.
