/**
 * How the client addresses the API.
 *
 * Nothing here may hardcode a leading-slash URL. The app has to work at `/`, at
 * an arbitrary reverse-proxy sub-path, and behind Home Assistant ingress, which
 * mints a per-session prefix like `/api/hassio_ingress/<token>/`. An absolute
 * `/api/seeds` would escape that prefix and 404.
 *
 * So every URL is resolved against the document base. The build sets Vite's
 * `base` to `'./'` and the server injects a matching `<base href>` into
 * `index.html`, which makes `document.baseURI` the authoritative mount point in
 * every deployment — including on a deep link, where the URL path alone would be
 * misleading.
 *
 * Phase 3 replaces `useLocalStorage` with a fetch-backed hook; it should build
 * every request through `apiUrl`.
 */

/** Where the app is mounted, always with a trailing slash. */
export function appBaseUrl(): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return document.baseURI.endsWith('/') ? document.baseURI : `${document.baseURI}/`;
  }

  // Vite injects BASE_URL at build time; the fallback matters only for SSR-ish
  // or test environments where there is no document.
  const base = import.meta.env.BASE_URL || './';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Absolute URL for an API path. `apiUrl('seeds')` and `apiUrl('/seeds')` are
 * both accepted and both resolve under the current mount point.
 */
export function apiUrl(path: string): string {
  const relative = `api/${path.replace(/^\/+/, '')}`;

  return new URL(relative, appBaseUrl()).toString();
}
