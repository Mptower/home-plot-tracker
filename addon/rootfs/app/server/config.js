/**
 * Every knob the server exposes, read once from the environment at boot.
 *
 * Defaults are resolved against `process.cwd()` rather than the location of this
 * file so that the same values mean the same thing whether the server is run
 * from source in development (`node src/index.ts`) or from `dist/` in
 * production. Run it from the `server/` directory, or set the paths explicitly.
 *
 * The deployment target is a Home Assistant add-on, which sets `DATA_DIR=/data`
 * — the volume HA's own backups snapshot. Everything the server persists goes
 * there, and it is created on boot if missing.
 */
import path from 'node:path';
export const CONFIG_DEFAULTS = {
    HOST: '0.0.0.0',
    PORT: '8080',
    BASE_PATH: '/',
    DATA_DIR: 'data',
    CLIENT_DIR: '../client/dist',
    SERVE_CLIENT: 'true',
    LOG_REQUESTS: 'true',
};
/** File created inside `DATA_DIR` unless `DATABASE_PATH` overrides it outright. */
export const DATABASE_FILENAME = 'home-plot-tracker.db';
export class ConfigError extends Error {
}
function parsePort(raw) {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new ConfigError(`PORT must be an integer between 0 and 65535, got ${JSON.stringify(raw)}`);
    }
    return port;
}
function parseBoolean(name, raw) {
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized))
        return true;
    if (['0', 'false', 'no', 'off'].includes(normalized))
        return false;
    throw new ConfigError(`${name} must be a boolean-ish value, got ${JSON.stringify(raw)}`);
}
/** `:memory:` is passed through untouched; anything else becomes an absolute path. */
function resolvePath(raw) {
    return raw === ':memory:' ? raw : path.resolve(process.cwd(), raw);
}
/**
 * Normalises a mount prefix to `''` (root) or `/one/two` — leading slash, no
 * trailing slash — which is the form Express's `app.use(prefix, ...)` wants.
 */
export function normalizeBasePath(raw) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '/')
        return '';
    const collapsed = `/${trimmed.split('/').filter(Boolean).join('/')}`;
    if (!/^(\/[A-Za-z0-9._~\-%]+)+$/.test(collapsed)) {
        throw new ConfigError(`BASE_PATH must be a simple URL path, got ${JSON.stringify(raw)}`);
    }
    return collapsed;
}
/** The `<base href>` form of a mount prefix: always leading and trailing slash. */
export function baseHref(basePath) {
    return basePath === '' ? '/' : `${basePath}/`;
}
export function loadConfig(env = process.env) {
    const dataDir = resolvePath(env.DATA_DIR?.trim() || CONFIG_DEFAULTS.DATA_DIR);
    // DATABASE_PATH, when set, wins outright — it may point outside DATA_DIR, or
    // be `:memory:`. Otherwise the file lives in DATA_DIR, which is the knob the
    // Home Assistant add-on sets (to `/data`, the volume HA backs up).
    const databaseOverride = env.DATABASE_PATH?.trim();
    return {
        host: env.HOST?.trim() || CONFIG_DEFAULTS.HOST,
        port: parsePort(env.PORT?.trim() || CONFIG_DEFAULTS.PORT),
        basePath: normalizeBasePath(env.BASE_PATH ?? CONFIG_DEFAULTS.BASE_PATH),
        dataDir,
        databasePath: databaseOverride
            ? resolvePath(databaseOverride)
            : path.join(dataDir, DATABASE_FILENAME),
        clientDir: resolvePath(env.CLIENT_DIR?.trim() || CONFIG_DEFAULTS.CLIENT_DIR),
        serveClient: parseBoolean('SERVE_CLIENT', env.SERVE_CLIENT?.trim() || CONFIG_DEFAULTS.SERVE_CLIENT),
        logRequests: parseBoolean('LOG_REQUESTS', env.LOG_REQUESTS?.trim() || CONFIG_DEFAULTS.LOG_REQUESTS),
        isProduction: (env.NODE_ENV ?? 'production') === 'production',
    };
}
//# sourceMappingURL=config.js.map