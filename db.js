const { Pool } = require("pg");

// DATABASE_URL tiene prioridad; sin ella se siguen usando PGHOST, PGUSER, etc.
function crearPool(env = process.env) {
    if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
        throw new Error("Configura DATABASE_URL antes de iniciar en producción");
    }
    return new Pool({
        ...(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {}),
        max: 5,
        connectionTimeoutMillis: 10000,
        query_timeout: 10000,
        idleTimeoutMillis: 30000
    });
}
module.exports = { crearPool };
