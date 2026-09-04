/**
 * Assembles the Express application.
 *
 * Split out from `index.ts` so tests can build an app around a throwaway
 * database and drive it over a real socket, without booting the process.
 */
import express from 'express';
import type { Express } from 'express';
import type { ServerConfig } from './config.ts';
import type { Database } from './db/open.ts';
import { errorHandler, requestLogger, sendError } from './http.ts';
import { createApiRouter } from './routes/api.ts';
import { mountClient } from './static.ts';

export interface CreateAppOptions {
  db: Database;
  config: ServerConfig;
}

export interface AppInfo {
  app: Express;
  /** False when `serveClient` is on but there is no build on disk. */
  clientMounted: boolean;
}

export function createApp({ db, config }: CreateAppOptions): AppInfo {
  const app = express();

  // Nothing here benefits from advertising the framework.
  app.disable('x-powered-by');
  // Behind Nginx Proxy Manager / Cloudflare, so the client IP is in a header.
  app.set('trust proxy', true);
  // A URL is a URL; `/api/seeds` and `/API/Seeds` should not be different routes.
  app.set('case sensitive routing', false);

  if (config.logRequests) {
    app.use(requestLogger());
  }

  // Mounted under the configured prefix so the whole app can live at a sub-path.
  app.use(`${config.basePath}/api`, createApiRouter(db));

  let clientMounted = false;

  if (config.serveClient) {
    const result = mountClient(app, config.clientDir, config.basePath);
    clientMounted = result.mounted;

    if (!result.mounted) {
      console.warn(
        `Not serving a client bundle (${result.reason}). ` +
          'Run `npm run build` first, set CLIENT_DIR, or set SERVE_CLIENT=false.',
      );
    }
  }

  app.use((req, res) => {
    sendError(res, 404, 'not_found', `Not found: ${req.method} ${req.originalUrl}`);
  });

  app.use(errorHandler(config.isProduction));

  return { app, clientMounted };
}
