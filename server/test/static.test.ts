/**
 * Serving the built client, at the root and under an arbitrary path prefix.
 *
 * The prefix cases exist because the deployment target may become a Home
 * Assistant add-on behind ingress, which serves the app under a generated path
 * like `/api/hassio_ingress/<token>/`. Nothing may assume it lives at `/`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, startServer, writeFakeClientBundle, tempDir } from './helpers.ts';
import { withBaseHref } from '../src/static.ts';
import fs from 'node:fs';

async function serverWithClient(overrides: Record<string, string> = {}) {
  const root = tempDir('hpt-client-');
  const clientDir = writeFakeClientBundle(root);
  const server = await startServer({ SERVE_CLIENT: 'true', CLIENT_DIR: clientDir, ...overrides });

  return {
    server,
    clientDir,
    async close() {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

test('the built client is served from disk by the Node server', async (t) => {
  const context = await serverWithClient();
  t.after(() => context.close());

  assert.equal(context.server.clientMounted, true);

  const response = await context.server.get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);

  const html = await response.text();
  assert.match(html, /<div id="root"><\/div>/);
});

test('index.html is never cached and hashed assets are immutable', async (t) => {
  const context = await serverWithClient();
  t.after(() => context.close());

  const page = await context.server.get('/');
  assert.equal(page.headers.get('cache-control'), 'no-cache');

  const asset = await context.server.get('/assets/index-abc12345.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  // Unhashed files copied from public/ sit in between: reusable, but revalidated.
  const publicFile = await context.server.get('/leaf.svg');
  assert.equal(publicFile.status, 200);
  assert.equal(publicFile.headers.get('cache-control'), 'public, max-age=3600, must-revalidate');
});

test('a deep link falls back to index.html', async (t) => {
  const context = await serverWithClient();
  t.after(() => context.close());

  for (const deepLink of ['/harvest', '/beds/3', '/vault?filter=herb']) {
    const response = await context.server.get(deepLink);
    assert.equal(response.status, 200, `deep link ${deepLink}`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /<div id="root"><\/div>/);
  }
});

test('the SPA fallback never swallows an API 404', async (t) => {
  const context = await serverWithClient();
  t.after(() => context.close());

  const response = await context.server.get('/api/tomatoes');
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
});

test('a missing client build is a warning, not a crash', async (t) => {
  const server = await startServer({ SERVE_CLIENT: 'true', CLIENT_DIR: 'definitely/not/here' });
  t.after(() => server.close());

  assert.equal(server.clientMounted, false);
  // The API still works, which is what keeps development usable.
  assert.equal((await server.get('/api/health')).status, 200);
});

test('the whole app can be mounted under a path prefix', async (t) => {
  const context = await serverWithClient({ BASE_PATH: '/garden' });
  t.after(() => context.close());

  assert.equal(context.server.config.basePath, '/garden');

  // The API lives under the prefix...
  const health = await fetch(`${context.server.origin}/garden/api/health`);
  assert.equal(health.status, 200);

  const put = await context.server.putJson('/api/seeds', [seed()]);
  assert.equal(put.status, 200);
  const stored = (await fetch(`${context.server.origin}/garden/api/seeds`).then((r) => r.json())) as unknown[];
  assert.equal(stored.length, 1);

  // ...and not at the root.
  const atRoot = await fetch(`${context.server.origin}/api/health`);
  assert.equal(atRoot.status, 404);
});

test('static files and the SPA fallback both respect the path prefix', async (t) => {
  const context = await serverWithClient({ BASE_PATH: '/garden' });
  t.after(() => context.close());

  const index = await fetch(`${context.server.origin}/garden/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<div id="root"><\/div>/);

  const asset = await fetch(`${context.server.origin}/garden/assets/index-abc12345.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const deepLink = await fetch(`${context.server.origin}/garden/harvest/2026`);
  assert.equal(deepLink.status, 200);
  assert.match(deepLink.headers.get('content-type') ?? '', /text\/html/);

  const outside = await fetch(`${context.server.origin}/harvest`);
  assert.equal(outside.status, 404, 'nothing is served outside the prefix');
});

test('index.html is given a <base href> matching the mount point', async (t) => {
  const rooted = await serverWithClient();
  t.after(() => rooted.close());

  const atRoot = await rooted.server.get('/').then((r) => r.text());
  assert.match(atRoot, /<base href="\/">/);

  const prefixed = await serverWithClient({ BASE_PATH: '/garden' });
  t.after(() => prefixed.close());

  const html = await fetch(`${prefixed.server.origin}/garden/deep/link`).then((r) => r.text());
  assert.match(html, /<base href="\/garden\/">/);
  // The relative asset reference plus that base is what makes a deep link work.
  assert.match(html, /src="\.\/assets\/index-abc12345\.js"/);
});

test('a Home Assistant ingress prefix is honoured per request', async (t) => {
  const context = await serverWithClient();
  t.after(() => context.close());

  const response = await context.server.get('/', {
    headers: { 'X-Ingress-Path': '/api/hassio_ingress/abc123token' },
  });

  assert.match(await response.text(), /<base href="\/api\/hassio_ingress\/abc123token\/">/);
  assert.match(response.headers.get('vary') ?? '', /X-Ingress-Path/i);
});

test('a hostile X-Ingress-Path cannot break out of the base attribute', async (t) => {
  const context = await serverWithClient();
  t.after(() => context.close());

  const response = await context.server.get('/', {
    headers: { 'X-Ingress-Path': '/x"><script>alert(1)</script>' },
  });
  const html = await response.text();

  assert.ok(!html.includes('<script>alert(1)</script>'), 'no script may be injected');
  assert.match(html, /<base href="\/">/, 'a malformed prefix falls back to the configured base');
});

test('withBaseHref inserts, replaces and escapes', () => {
  assert.equal(
    withBaseHref('<html><head><title>t</title></head></html>', '/garden/'),
    '<html><head>\n    <base href="/garden/"><title>t</title></head></html>',
  );

  assert.equal(
    withBaseHref('<head><base href="/"></head>', '/garden/'),
    '<head><base href="/garden/"></head>',
  );

  assert.match(withBaseHref('<head></head>', '/a"b/'), /<base href="\/a&quot;b\/">/);
});
