import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.POSTGRES_URL;

let pool;
let normalizedConnectionString;
let connectionLogged = false;

export function isDatabaseConfigured() {
    return Boolean(connectionString);
}

function getConnectionString() {
    if (!connectionString)
        throw new Error('POSTGRES_URL is not configured.');

    if (!normalizedConnectionString) {
        let url;

        try {
            url = new URL(connectionString);
        }
        catch {
            throw new Error('POSTGRES_URL is not a valid PostgreSQL URL.');
        }

        if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
            throw new Error('POSTGRES_URL must use the postgres:// or postgresql:// scheme.');

        url.searchParams.set('sslmode', 'verify-full');
        normalizedConnectionString = url.toString();
    }

    return normalizedConnectionString;
}

function logConnected() {
    if (connectionLogged)
        return;

    connectionLogged = true;
    console.log('[PostgreSQL] Connected to database.');
}

export function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: getConnectionString(),
            max: 3,
            idleTimeoutMillis: 10_000,
            connectionTimeoutMillis: 10_000
        });

        pool.on('connect', logConnected);
        pool.on('error', () => {
            console.error('[PostgreSQL] Pool error.');
        });
    }

    return pool;
}

export function query(text, params) {
    return getPool().query(text, params);
}

export function getClient() {
    return getPool().connect();
}

export async function logDatabaseConnection() {
    if (!connectionString) {
        console.warn('[PostgreSQL] POSTGRES_URL is not configured.');
        return false;
    }

    try {
        await query('SELECT 1');
        logConnected();
        return true;
    }
    catch {
        console.error('[PostgreSQL] Connection failed.');
        return false;
    }
}

export async function closePool() {
    if (!pool)
        return;

    await pool.end();
    pool = undefined;
    normalizedConnectionString = undefined;
    connectionLogged = false;
}

export { pg };
