const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { randomBytes } = require("node:crypto");

module.exports = function crearRutasAuth(pool) {
    const router = express.Router();

    const secreto = process.env.JWT_SECRET || "";

    if (!/^[0-9a-f]{64}$/i.test(secreto)) {
        throw new Error(
            "Configura JWT_SECRET en .env con los 64 caracteres generados"
        );
    }

    // Se calcula una sola vez al iniciar.
    // Permite comprobar un hash incluso si el usuario no existe.
    const hashAlternativo = bcrypt.hashSync(
        randomBytes(32).toString("hex"),
        12
    );

    const limitarLogin = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: {
            ok: false,
            mensaje: "Demasiados intentos. Intenta nuevamente en 15 minutos"
        }
    });

    router.post("/login", limitarLogin, async (req, res) => {
        res.set("Cache-Control", "no-store");

        const datos = req.body;

        if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
            return res.status(400).json({
                ok: false,
                mensaje: "Envía un objeto JSON con usuario y password"
            });
        }

        const { usuario, password } = datos;

        if (typeof usuario !== "string"
                || typeof password !== "string"
                || !usuario.trim()
                || password.length === 0) {
            return res.status(400).json({
                ok: false,
                mensaje: "Ingresa usuario y contraseña"
            });
        }

        const usuarioNormalizado = usuario.trim().toLowerCase();

        if (!/^[a-z0-9_]{3,30}$/.test(usuarioNormalizado)
                || Buffer.byteLength(password, "utf8") > 72) {
            return res.status(400).json({
                ok: false,
                mensaje: "El formato de las credenciales no es válido"
            });
        }

        try {
            const resultado = await pool.query(`
                SELECT id, nombre, usuario, password_hash, activo, rol
                FROM public.usuarios
                WHERE usuario = $1
            `, [usuarioNormalizado]);

            const cuenta = resultado.rows[0];

            // No recortamos ni modificamos la contraseña.
            const passwordCorrecto = await bcrypt.compare(
                password,
                cuenta ? cuenta.password_hash : hashAlternativo
            );

            if (!cuenta || !passwordCorrecto || !cuenta.activo) {
                return res.status(401).json({
                    ok: false,
                    mensaje: "Usuario o contraseña incorrectos"
                });
            }

            // El token identifica al usuario y vence en una hora.
            const token = jwt.sign(
                {},
                secreto,
                {
                    algorithm: "HS256",
                    subject: String(cuenta.id),
                    issuer: "ecoregistro-api",
                    audience: "ecoregistro-app",
                    expiresIn: "1h"
                }
            );

            return res.status(200).json({
                ok: true,
                mensaje: "Inicio de sesión correcto",
                token,
                tipo_token: "Bearer",
                expira_en_segundos: 3600,
                usuario: {
                    id: cuenta.id,
                    nombre: cuenta.nombre,
                    usuario: cuenta.usuario,
                    rol: cuenta.rol
                }
            });

        } catch (error) {
            console.error("Error al iniciar sesión:", error.message);

            return res.status(500).json({
                ok: false,
                mensaje: "No se pudo iniciar sesión. Intenta nuevamente"
            });
        }
    });

    return router;
};