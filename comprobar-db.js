const { crearPool } = require("./db");
const pool = crearPool();
(async () => {
    try {
        // Comprueba que existen todas las columnas que usa la API, sin modificar datos.
        await pool.query(`SELECT id, nombre, usuario, password_hash, activo, rol FROM public.usuarios LIMIT 0`);
        await pool.query(`SELECT id, uuid, responsable, zona, tipo_residuo, cantidad, unidad,
            observaciones, fecha_registro, fecha_recepcion, usuario_id FROM public.recolecciones LIMIT 0`);
        console.table((await pool.query(`SELECT id, nombre, usuario, activo, rol FROM public.usuarios ORDER BY usuario`)).rows);
        console.table((await pool.query(`SELECT usuario_id, COUNT(*) AS registros FROM public.recolecciones GROUP BY usuario_id`)).rows);
        console.log("Columnas necesarias disponibles. Compara cuentas y cantidades con la base original.");
    } catch (error) {
        console.error("No se pudo comprobar la base:", error.message);
        process.exitCode = 1;
    } finally { await pool.end(); }
})();
