/**
 * The facts that describe a backup file, kept apart from everything that
 * touches the database so the validator can read them without importing the
 * storage layer.
 *
 * `BACKUP_FORMAT` and `BACKUP_FORMAT_VERSION` are re-exported from
 * `@hpt/shared` rather than declared here. They used to be declared here, as a
 * deliberate duplicate of the browser's copy, because `server/src` could only
 * take *types* from that package — the add-on image shipped `server/dist/src`
 * and `client/dist` and no `shared/` at all, so a runtime import would have
 * passed every test on a developer machine and then failed on her Home
 * Assistant at boot with `ERR_MODULE_NOT_FOUND`.
 *
 * That was fixed rather than worked around: the image now stages the shared
 * build and links it in as a `file:` dependency, and
 * `server/test/shared-imports.test.ts` guards the staging that makes it true.
 * So there is one definition and nothing to drift.
 */
export { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from '@hpt/shared';
/** Why a safety copy was taken. One value today. */
export const PRE_RESTORE = 'pre-restore';
//# sourceMappingURL=format.js.map