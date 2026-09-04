/**
 * Process entry point: read the environment, open the database, migrate it,
 * start listening, and shut down cleanly when systemd says so.
 */
import { baseHref, loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { journalMode, openDatabase } from './db/open.ts';
import { runMigrations } from './db/migrate.ts';

function main(): void {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);

  // Migrations run on every boot. They are idempotent, so an already-current
  // database costs one indexed read and nothing else.
  const report = runMigrations(db);

  console.log(`Database: ${config.databasePath} (journal_mode=${journalMode(db)})`);
  console.log(
    report.applied.length > 0
      ? `Applied migrations: ${report.applied.join(', ')} (schema version ${report.currentVersion})`
      : `Schema already at version ${report.currentVersion}`,
  );

  const { app, clientMounted } = createApp({ db, config });

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `The Home Plot Tracker API is listening on http://${config.host}:${config.port}${baseHref(config.basePath)}`,
    );
    console.log(
      clientMounted
        ? `Serving the client bundle from ${config.clientDir}`
        : 'API only — no client bundle is being served',
    );
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`Received ${signal}, shutting down`);

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
