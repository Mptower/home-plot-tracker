/**
 * The contract between the server's Home Assistant integration and the browser.
 *
 * Three rules shape everything in this file.
 *
 * **The token never leaves the server.** Home Assistant is reached with
 * `SUPERVISOR_TOKEN` against `http://supervisor/core/api`, which is a
 * credential the browser must never see and could not use anyway. So the client
 * is not given a proxy to Home Assistant; it is given this, a small purpose-built
 * body containing only what the banner renders.
 *
 * **Absence is a normal answer, not a failure.** The app has to run perfectly on
 * a laptop with no Home Assistant at all — that is how it is developed and how
 * the tests run. So the endpoint always answers `200`, and "there is no Home
 * Assistant here" arrives as data rather than as a `404`, a `503` or a timeout.
 * A client that gets `available: false` renders nothing and says nothing. There
 * is deliberately no error state to design, because there is no error.
 *
 * **This file is types only.** Not because a value here would be unsafe — the
 * add-on image now ships this package, so the server imports the plant
 * catalogue and the tenderness map from it at runtime — but because this
 * particular file describes a wire contract, and a wire contract with
 * behaviour in it stops being one. The frost bands, the forecast reading and
 * the assessment itself live in `server/src/ha/`; only the shapes they produce
 * live here.
 *
 * What the image does and does not contain is enforced by
 * `server/test/shared-imports.test.ts`: a server source may import this package
 * as a runtime value exactly as long as `addon/rootfs/app/` actually stages it.
 */
export {};
//# sourceMappingURL=homeAssistant.js.map