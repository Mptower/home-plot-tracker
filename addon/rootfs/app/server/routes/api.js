/**
 * The API.
 *
 * Shape: **collection-level GET and PUT**. `GET /api/seeds` returns the whole
 * array, `PUT /api/seeds` replaces it. That is not a shortcut — it is the same
 * contract the React views already have. Each view receives `(data, setData)`
 * and hands back a complete new array; mirroring that here means the client's
 * storage layer can be swapped from `localStorage` to `fetch` without touching a
 * single view component.
 *
 * A per-item CRUD surface would need ids threaded through every mutation, an
 * optimistic-update story and a merge strategy, for one user editing a few dozen
 * rows. Replace is cheaper to write, far cheaper to reason about, and trivially
 * atomic.
 */
import express from 'express';
import { withTransaction } from "../db/open.js";
import { listBeds, listHarvests, listSeeds, replaceBeds, replaceHarvests, replaceSeeds, } from "../db/collections.js";
import { appliedVersions } from "../db/migrate.js";
import { requireJsonBody, sendError, sendValidationError } from "../http.js";
import { validateBeds, validateHarvests, validateSeeds, validateSnapshot } from "../validation.js";
/** Bodies are three small arrays; 4 MB is roomy for a decade of harvests. */
const BODY_LIMIT = '4mb';
const SEEDS = {
    path: '/seeds',
    read: listSeeds,
    replace: replaceSeeds,
    validate: validateSeeds,
};
const BEDS = {
    path: '/beds',
    read: listBeds,
    replace: replaceBeds,
    validate: validateBeds,
};
const HARVESTS = {
    path: '/harvests',
    read: listHarvests,
    replace: replaceHarvests,
    validate: validateHarvests,
};
function mountCollection(router, db, endpoint) {
    router.get(endpoint.path, (_req, res) => {
        res.json(endpoint.read(db));
    });
    router.put(endpoint.path, requireJsonBody, (req, res) => {
        const result = endpoint.validate(req.body);
        if (!result.ok) {
            sendValidationError(res, result.issues);
            return;
        }
        // One transaction around delete-then-insert: a failure part-way through can
        // never leave the collection half replaced.
        withTransaction(db, () => {
            endpoint.replace(db, result.value);
        });
        // Read back rather than echoing the request, so the response is proof of
        // what was actually stored.
        res.json(endpoint.read(db));
    });
}
export function createApiRouter(db) {
    const router = express.Router();
    router.use(express.json({
        limit: BODY_LIMIT,
        type: 'application/json',
        // `strict: false` so a scalar body like `42` or `"nope"` is parsed and then
        // rejected by the validator with "expected an array, received number".
        // Leaving it strict would report it as a JSON parse failure, which is
        // simply untrue and sends whoever is debugging an import in the wrong
        // direction.
        strict: false,
    }));
    router.get('/health', (_req, res) => {
        // Touch the database so the check fails if the file has gone away, which is
        // the failure systemd and uptime monitoring actually need to see.
        const versions = appliedVersions(db);
        res.json({
            status: 'ok',
            uptimeSeconds: Math.round(process.uptime()),
            schemaVersion: versions.at(-1) ?? 0,
            timestamp: new Date().toISOString(),
        });
    });
    mountCollection(router, db, SEEDS);
    mountCollection(router, db, BEDS);
    mountCollection(router, db, HARVESTS);
    /**
     * The migration path off `localStorage`. His wife's phone and laptop each hold
     * a divergent copy; this takes one of them and makes it the server's truth.
     *
     * It **replaces**, it does not merge. Merging two divergent collections with no
     * per-record timestamps would mean guessing, and a wrong guess silently
     * resurrects deleted rows. The response says which happened in as many words.
     */
    router.post('/import', requireJsonBody, (req, res) => {
        const result = validateSnapshot(req.body);
        if (!result.ok) {
            sendValidationError(res, result.issues);
            return;
        }
        const previous = {
            seeds: listSeeds(db).length,
            beds: listBeds(db).length,
            harvests: listHarvests(db).length,
        };
        // All three collections land together or not at all.
        withTransaction(db, () => {
            replaceSeeds(db, result.value.seeds);
            replaceBeds(db, result.value.beds);
            replaceHarvests(db, result.value.harvests);
        });
        res.json({
            mode: 'replace',
            message: 'Replaced all existing data with the imported snapshot. Nothing was merged; ' +
                'any records that were on the server and not in this payload are gone.',
            replaced: previous,
            imported: {
                seeds: result.value.seeds.length,
                beds: result.value.beds.length,
                harvests: result.value.harvests.length,
            },
        });
    });
    router.use((req, res) => {
        sendError(res, 404, `No API route for ${req.method} ${req.originalUrl}`);
    });
    return router;
}
//# sourceMappingURL=api.js.map