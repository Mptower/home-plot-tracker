/**
 * Serving the built client from disk, at any mount point.
 *
 * Three things have to be right:
 *
 * 1. **Cache headers.** Vite fingerprints everything it emits into `assets/`, so
 *    those files are immutable for a year. `index.html` is the one unhashed file
 *    that names them, so it must never be cached or a browser will keep loading
 *    last week's bundle.
 * 2. **SPA fallback.** The app has no server-side routes; any GET that is not a
 *    real file is answered with `index.html` so a deep link or a refresh works.
 * 3. **An arbitrary path prefix.** The app may be mounted at `/`, or under a
 *    reverse-proxy sub-path, or behind Home Assistant ingress, which invents a
 *    per-session prefix like `/api/hassio_ingress/<token>/`. The build uses a
 *    relative `base`, so the only thing needed to make every relative URL in the
 *    document resolve correctly is a `<base href>` that names the real prefix.
 *    That is injected here, per request, because under ingress the prefix is not
 *    known until the request arrives.
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Express, Request } from 'express';
import { baseHref } from './config.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';
/** Unhashed files copied straight from `public/`: revalidate, but allow reuse. */
const REVALIDATE = 'public, max-age=3600, must-revalidate';

const BASE_TAG_PATTERN = /<base\b[^>]*>/i;
const HEAD_PATTERN = /<head\b[^>]*>/i;

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Home Assistant ingress tells the add-on what prefix the browser sees via
 * `X-Ingress-Path`. Honouring it means the same build works both standalone and
 * as an add-on with no rebuild and no configuration.
 *
 * Only a well-formed absolute path is accepted — the value ends up in an HTML
 * attribute, so a header from an untrusted proxy must not be able to smuggle
 * anything into the document.
 */
export function effectiveBaseHref(req: Request, configuredBasePath: string): string {
  const header = req.get('x-ingress-path');

  if (header && /^\/[A-Za-z0-9._~\-%/]*$/.test(header)) {
    const normalized = header.replace(/\/+$/, '');
    return normalized === '' ? '/' : `${normalized}/`;
  }

  return baseHref(configuredBasePath);
}

/** Rewrites (or inserts) the `<base>` tag so relative URLs resolve under `href`. */
export function withBaseHref(html: string, href: string): string {
  const tag = `<base href="${escapeHtmlAttribute(href)}">`;

  if (BASE_TAG_PATTERN.test(html)) {
    return html.replace(BASE_TAG_PATTERN, tag);
  }

  if (HEAD_PATTERN.test(html)) {
    return html.replace(HEAD_PATTERN, (head) => `${head}\n    ${tag}`);
  }

  return `${tag}${html}`;
}

function cacheControlFor(filePath: string): string {
  const relative = filePath.split(path.sep).join('/');

  if (relative.endsWith('/index.html') || relative.endsWith('index.html')) return NO_CACHE;
  // Everything Vite emits into assets/ carries a content hash in its name.
  if (relative.includes('/assets/')) return IMMUTABLE;

  return REVALIDATE;
}

export interface ClientHostResult {
  mounted: boolean;
  reason?: string;
}

/**
 * Mounts the built client at `basePath`. Returns `mounted: false` (rather than
 * throwing) when there is no build on disk, so the API is still usable in
 * development and the failure is a log line instead of a crash loop.
 */
export function mountClient(app: Express, clientDir: string, basePath: string): ClientHostResult {
  const indexPath = path.join(clientDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return { mounted: false, reason: `no index.html at ${indexPath}` };
  }

  const mountPath = basePath === '' ? '/' : basePath;

  app.use(
    mountPath,
    express.static(clientDir, {
      // index.html is handled by the fallback below so it gets the <base> tag.
      index: false,
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        res.setHeader('Cache-Control', cacheControlFor(filePath));
      },
    }),
  );

  app.use(mountPath, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    // Anything still unmatched under /api is a bad API call, not a deep link;
    // let it fall through to the router's JSON 404.
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }

    let html: string;

    try {
      html = fs.readFileSync(indexPath, 'utf8');
    } catch (error) {
      next(error);
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', NO_CACHE);
    // The body depends on the ingress prefix, so caches must not share it.
    res.setHeader('Vary', 'X-Ingress-Path');
    res.send(withBaseHref(html, effectiveBaseHref(req, basePath)));
  });

  return { mounted: true };
}
