import {
    closePool,
    getClient,
    getPool,
    isDatabaseConfigured,
    logDatabaseConnection,
    query
} from './postgres.js';

export const database = {
    query,
    getClient,
    getPool,
    isDatabaseConfigured,
    logDatabaseConnection,
    closePool,
    exec: sql => query(sql)
};

export default database;
