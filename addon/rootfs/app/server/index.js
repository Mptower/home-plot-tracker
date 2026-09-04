/**
 * Process entry point: read the environment, open the database, migrate it,
 * start listening, and shut down cleanly when systemd says so.
 */
import { baseHref, loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { journalMode, openDatabase } from "./db/open.js";
import { runMigrations } from "./db/migrate.js";
import { readLegacyNotificationSettings } from "./ha/options.js";
import { HomeAssistantService } from "./ha/service.js";
function main() {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    // Migrations run on every boot. They are idempotent, so an already-current
    // database costs one indexed read and nothing else.
    //
    // The seed is only ever used the first time the settings row is created. On
    // an upgrade from 0.2.0 that means her existing add-on options — read here
    // rather than inside the migration, so `db/` stays independent of `ha/` and
    // the migration is deterministic given its input.
    const report = runMigrations(db, undefined, {
        settingsSeed: readLegacyNotificationSettings(config.homeAssistant.optionsPath),
    });
    console.log(`Database: ${config.databasePath} (journal_mode=${journalMode(db)})`);
    console.log(report.applied.length > 0
        ? `Applied migrations: ${report.applied.join(', ')} (schema version ${report.currentVersion})`
        : `Schema already at version ${report.currentVersion}`);
    // `null` whenever there is no SUPERVISOR_TOKEN, which is every deployment
    // that is not the Home Assistant add-on — including `npm run dev`. Nothing
    // starts, nothing is polled and no request is ever made in that case.
    const homeAssistant = HomeAssistantService.create({ db, env: config.homeAssistant });
    if (homeAssistant === null) {
        console.log('Home Assistant integration disabled (no SUPERVISOR_TOKEN).');
    }
    const { app, clientMounted } = createApp({
        db,
        config,
        homeAssistant: homeAssistant
            ? {
                onGardenChanged: () => homeAssistant.onGardenChanged(),
                homeAssistant: () => homeAssistant.snapshot(),
                integrationStatus: () => homeAssistant.status(),
            }
            : undefined,
    });
    const server = app.listen(config.port, config.host, () => {
        console.log(`The Home Plot Tracker API is listening on http://${config.host}:${config.port}${baseHref(config.basePath)}`);
        console.log(clientMounted
            ? `Serving the client bundle from ${config.clientDir}`
            : 'API only — no client bundle is being served');
        // Started only after the socket is up, so a slow Supervisor can never
        // delay the app becoming answerable.
        homeAssistant?.start();
    });
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.log(`Received ${signal}, shutting down`);
        homeAssistant?.stop();
        server.close(() => {
            // Closing the handle checkpoints the WAL, so the .db file is complete on
            // disk for whatever backs it up.
            db.close();
            process.exit(0);
        });
        // Do not let a hung connection block a restart forever.
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
main();
//# sourceMappingURL=index.js.map