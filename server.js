const express = require("express");
const { crearPool } = require("./db");
const crearRutasAuth = require("./auth");
const crearVerificador = require("./verificar-sesion");

function crearApp(pool, env = process.env) {
const app = express();
app.disable("x-powered-by");
// Un salto para el proxy de entrada de Render; sin proxy en ejecución local.
const saltos = Number(env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(saltos) || saltos < 0 || saltos > 10) {
    throw new Error("TRUST_PROXY_HOPS debe ser un entero de 0 a 10");
}
app.set("trust proxy", saltos);
app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

app.use(express.json());

app.use("/api/recolecciones", crearVerificador(pool));
app.use("/api/auth", crearRutasAuth(pool));
app.use("/api/auth", require("./v2").registro(pool));
app.use("/api/v2", require("./v2").rutas(pool));

// Comprueba que la API puede consultar la base de datos.
app.get("/api/salud", async (req, res) => {
    try {
        const resultado = await pool.query(
            "SELECT current_database() AS base_datos"
        );

        res.status(200).json({
            ok: true,
            mensaje: "API de EcoRegistro conectada a PostgreSQL",
            base_datos: resultado.rows[0].base_datos
        });
    } catch (error) {
        console.error("Error al consultar PostgreSQL:", error.message);

        res.status(503).json({
            ok: false,
            mensaje: "No se pudo conectar con la base de datos"
        });
    }
});
// Consulta las últimas 100 recolecciones.
app.get("/api/recolecciones", async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT
                id,
                uuid,
                responsable,
                zona,
                tipo_residuo,
                cantidad,
                unidad,
                observaciones,
                fecha_registro,
                fecha_recepcion
            FROM public.recolecciones
            WHERE usuario_id = $1
            ORDER BY fecha_registro DESC, id DESC
            LIMIT 100
            `, [req.usuarioId]);  

        res.status(200).json({
            ok: true,
            cantidad: resultado.rows.length,
            recolecciones: resultado.rows
        });
    } catch (error) {
        console.error("Error al consultar recolecciones:", error.message);

        res.status(500).json({
            ok: false,
            mensaje: "No se pudieron consultar las recolecciones"
        });
    }
});
// Recibe y guarda una recolección.
app.post("/api/recolecciones", async (req, res) => {
    const datos = req.body;

    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
        return res.status(400).json({
            ok: false,
            mensaje: "Envía un objeto JSON con los datos"
        });
    }

    const {
        uuid,
        responsable,
        zona,
        tipo_residuo,
        cantidad,
        unidad,
        fecha_registro,
        observaciones = ""
    } = datos;

    // UUID versión 4, como el generado por nuestra app Android.
    const patronUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const tiposPermitidos = [
        "Papel y cartón",
        "Plástico",
        "Vidrio",
        "Metal",
        "Orgánicos",
        "No aprovechables"
    ];

    const errores = [];

    if (typeof uuid !== "string" || !patronUuid.test(uuid)) {
        errores.push("El UUID debe ser válido y de versión 4");
    }

    if (typeof responsable !== "string" || !responsable.trim() || responsable.length > 150) {
        errores.push("Ingresa el responsable");
    }

    if (typeof zona !== "string" || !zona.trim() || zona.length > 150) {
        errores.push("Ingresa la zona");
    }

    if (!tiposPermitidos.includes(tipo_residuo)) {
        errores.push("Selecciona un tipo de residuo válido");
    }

    if (typeof cantidad !== "number"
            || !Number.isFinite(cantidad)
            || cantidad <= 0) {
        errores.push("La cantidad debe ser un número mayor que cero");
    }

    if (!["kg", "L"].includes(unidad)) {
        errores.push("La unidad debe ser kg o L");
    }

    if (typeof observaciones !== "string" || observaciones.length > 4000) {
        errores.push("Las observaciones deben ser texto");
    }

    if (!Number.isSafeInteger(fecha_registro) || fecha_registro <= 0) {
        errores.push("La fecha debe ser un entero positivo en milisegundos");
    }

    if (errores.length > 0) {
        return res.status(400).json({
            ok: false,
            mensaje: "Revisa los datos enviados",
            errores
        });
    }

    const valores = [
        uuid.toLowerCase(),
        responsable.trim(),
        zona.trim(),
        tipo_residuo,
        cantidad,
        unidad,
        observaciones.trim(),
        fecha_registro,
        req.usuarioId
    ];

    try {
        // Los valores se envían separados del texto SQL.
        const resultado = await pool.query(`
            INSERT INTO public.recolecciones (
                uuid,
                responsable,
                zona,
                tipo_residuo,
                cantidad,
                unidad,
                observaciones,
                fecha_registro,
                usuario_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (uuid) DO NOTHING
            RETURNING id, uuid
        `, valores);

        if (resultado.rowCount === 1) {
            return res.status(201).json({
                ok: true,
                mensaje: "Recolección guardada",
                ya_existia: false,
                recoleccion: resultado.rows[0]
            });
        }

        // Si el UUID existe, comprueba que sea el mismo contenido.
        const existente = await pool.query(`
            SELECT
                id,
                uuid,
                (
                    responsable = $2
                    AND zona = $3
                    AND tipo_residuo = $4
                    AND cantidad = $5
                    AND unidad = $6
                    AND observaciones = $7
                    AND fecha_registro = $8
                ) AS coincide
            FROM public.recolecciones
            WHERE uuid = $1 AND usuario_id = $9
        `, valores);

        const registro = existente.rows[0];

        if (!registro) {
           return res.status(409).json({
              ok: false,
              mensaje: "No se puede registrar esa recolección con esta cuenta"
          });
    }

        if (!registro.coincide) {
            return res.status(409).json({
                ok: false,
                mensaje: "Este UUID ya existe con datos diferentes"
            });
        }

        return res.status(200).json({
            ok: true,
            mensaje: "La recolección ya estaba guardada",
            ya_existia: true,
            recoleccion: {
                id: registro.id,
                uuid: registro.uuid
            }
        });
    } catch (error) {
        console.error("Error al guardar recolección:", error.message);

        return res.status(500).json({
            ok: false,
            mensaje: "No se pudo guardar la recolección"
        });
    }
});

// Respuestas JSON también para cuerpos inválidos o demasiado grandes.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const codigo = error.type === "entity.too.large" ? 413
        : error.type === "entity.parse.failed" ? 400 : 500;
    res.status(codigo).json({ ok: false, mensaje: codigo === 413
        ? "El cuerpo enviado es demasiado grande"
        : codigo === 400 ? "El JSON enviado no es válido" : "Error interno del servidor" });
});
return app;
}

function iniciar() {
    const puerto = Number(process.env.PORT || 3000);
    if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
        throw new Error("PORT debe ser un puerto válido");
    }
    const pool = crearPool();
    pool.on("error", error => console.error("Error PostgreSQL:", error.message));
    const app = crearApp(pool);
    const servidor = app.listen(puerto, "0.0.0.0", () => {
        console.log(`EcoRegistro listo en el puerto ${puerto}`);
    });
    let cerrando = false;
    const cerrar = () => {
        if (cerrando) return;
        cerrando = true;
        const limite = setTimeout(() => process.exit(1), 15000);
        limite.unref();
        servidor.close(async () => {
            try { await pool.end(); } finally { clearTimeout(limite); }
        });
    };
    process.on("SIGTERM", cerrar);
    process.on("SIGINT", cerrar);
    return servidor;
}
if (require.main === module) iniciar();
module.exports = { crearApp, iniciar };
