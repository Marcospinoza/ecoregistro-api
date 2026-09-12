const jwt = require("jsonwebtoken");

module.exports = function crearVerificador(pool) {
    const secreto = process.env.JWT_SECRET || "";

    if (!/^[0-9a-f]{64}$/i.test(secreto)) {
        throw new Error("JWT_SECRET no está configurado correctamente");
    }

    return async function verificarSesion(req, res, next) {
        const autorizacion = req.get("Authorization") || "";
        const partes = autorizacion.match(/^Bearer ([^\s]+)$/i);

        if (!partes) {
            return res.status(401).json({
                ok: false,
                mensaje: "Debes iniciar sesión"
            });
        }

        let datos;

        try {
            datos = jwt.verify(partes[1], secreto, {
                algorithms: ["HS256"],
                issuer: "ecoregistro-api",
                audience: "ecoregistro-app"
            });

            if (typeof datos !== "object"
                    || typeof datos.sub !== "string"
                    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datos.sub)) {
                throw new Error("Identidad inválida");
            }
        } catch {
            return res.status(401).json({
                ok: false,
                mensaje: "La sesión venció o no es válida. Inicia sesión nuevamente"
            });
        }

        try {
            const resultado = await pool.query(`
                SELECT id, rol
                FROM public.usuarios
                WHERE id = $1 AND activo = TRUE
            `, [datos.sub]);

            if (resultado.rowCount !== 1) {
                return res.status(401).json({
                    ok: false,
                    mensaje: "La cuenta no está disponible"
                });
            }

            // La identidad procede del token verificado.
            req.usuarioId = resultado.rows[0].id;
            req.rol = resultado.rows[0].rol;

            return next();

        } catch (error) {
            console.error("Error al verificar sesión:", error.message);

            return res.status(503).json({
                ok: false,
                mensaje: "No se pudo verificar la sesión. Intenta nuevamente"
            });
        }
    };
};