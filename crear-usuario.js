const { crearPool } = require("./db");
const bcrypt = require("bcryptjs");

const pool = crearPool();

async function crearUsuario() {
    try {
        const nombre = (process.env.CREAR_NOMBRE || "").trim();

        const usuario = (process.env.CREAR_USUARIO || "")
            .trim()
            .toLowerCase();

        // La contraseña se conserva exactamente como fue escrita.
        const password = process.env.CREAR_PASSWORD || "";

        if (!nombre) {
            throw new Error("Falta CREAR_NOMBRE en .env");
        }

        if (!/^[a-z0-9_]{3,30}$/.test(usuario)) {
            throw new Error(
                "El usuario debe tener entre 3 y 30 caracteres: "
                + "letras minúsculas, números o guion bajo"
            );
        }

        if (password === "REEMPLAZA_ESTO" || password.length < 12) {
            throw new Error(
                "Define una contraseña propia de al menos 12 caracteres"
            );
        }

        // bcrypt admite un máximo de 72 bytes.
        if (Buffer.byteLength(password, "utf8") > 72) {
            throw new Error("La contraseña supera los 72 bytes permitidos");
        }

        // Genera un hash con una sal aleatoria.
        const rol = process.env.CREAR_ROL || "recolector";
        if (!["recolector", "administrador"].includes(rol)) throw new Error("CREAR_ROL inválido");
        const passwordHash = await bcrypt.hash(password, 12);

        const resultado = await pool.query(`
            INSERT INTO public.usuarios (
                nombre,
                usuario,
                password_hash, rol
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (usuario) DO NOTHING
            RETURNING id, nombre, usuario, activo, rol
        `, [nombre, usuario, passwordHash, rol]);

        if (resultado.rowCount === 0) {
            console.log(
                "Ese usuario ya existe. No se modificó su contraseña."
            );
            return;
        }

        console.log("Usuario creado correctamente:");
        console.table(resultado.rows);

    } catch (error) {
        console.error("No se pudo crear el usuario:", error.message);
        process.exitCode = 1;

    } finally {
        // Cierra las conexiones para que termine el script.
        await pool.end();
    }
}

crearUsuario();