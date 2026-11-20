import { randomBytes } from 'node:crypto';

import {
    getPool,
    isDatabaseConfigured,
    query
} from './postgres.js';

export { isDatabaseConfigured };

const LOGIN_TTL_MS = 10 * 60 * 1000;

let schemaPromise;

export function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = query(`
            CREATE TABLE IF NOT EXISTS lastfm_logins (
                state TEXT PRIMARY KEY,
                discord_user_id TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `)
            .then(() => query(`
                CREATE TABLE IF NOT EXISTS lastfm_sessions (
                    discord_user_id TEXT PRIMARY KEY,
                    lastfm_username TEXT NOT NULL,
                    session_key TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `))
            .then(() => query(`
                CREATE INDEX IF NOT EXISTS lastfm_logins_discord_user_id_idx
                    ON lastfm_logins (discord_user_id)
            `))
            .catch(error => {
                schemaPromise = undefined;
                throw error;
            });
    }

    return schemaPromise;
}

export async function createPendingLogin(discordUserId) {
    await ensureSchema();

    const state = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + LOGIN_TTL_MS);

    await query(`
        INSERT INTO lastfm_logins (state, discord_user_id, expires_at)
        VALUES ($1, $2, $3)
    `, [state, discordUserId, expiresAt]);

    return state;
}

export async function getLastfmSession(discordUserId) {
    await ensureSchema();

    const { rows } = await query(`
        SELECT lastfm_username, session_key, updated_at
        FROM lastfm_sessions
        WHERE discord_user_id = $1
    `, [discordUserId]);

    return rows[0] || null;
}

export async function deleteLastfmSession(discordUserId) {
    await ensureSchema();

    const { rowCount } = await query(`
        DELETE FROM lastfm_sessions
        WHERE discord_user_id = $1
    `, [discordUserId]);

    return rowCount > 0;
}

export function getLastfmPool() {
    return getPool();
}
