/**
 * Offering to fix a packet that was filed under the wrong family.
 *
 * Her cherry tomato is sitting in the database as a Leafy Green. The frost
 * engine reads Leafy Green as hardy, so her tomatoes are not being warned
 * about, four weeks out from first frost. The catalogue knows better — but
 * knowing better is not permission to go and rewrite her records.
 *
 * So nothing here changes anything. `findCategoryFixes` reports what looks
 * wrong; the banner shows it with the consequence spelled out; and the change
 * only happens when she clicks. A migration that quietly reclassified her
 * packets on upgrade would have fixed the frost warning and broken something
 * much more expensive, which is her belief that the app leaves her records
 * alone.
 *
 * Dismissal is keyed on the variety *and* the category it is filed under, so
 * waving the nudge away is a judgement about one specific disagreement. If she
 * later refiles that packet under something else and the catalogue still
 * disagrees, it is a new disagreement and worth asking about again.
 *
 * ## Why only exact matches are ever queried
 *
 * The matcher will happily resolve a variety that merely *contains* a plant it
 * knows — that is how "Sungold Cherry Tomato" and "Brandywine Tomato" get a
 * family on the way into the vault, and it is right there that it is safe,
 * because the category field is on screen with the derived value visible and a
 * hint inviting her to change it.
 *
 * Overruling a decision she made months ago deserves a higher bar than filling
 * in a blank, and the substring matcher is not good enough to clear it.
 * "Chocolate Cherry" is a cherry tomato; a substring match reads the word
 * "cherry" and calls it Fruit. Nudging her to "correct" a correctly-filed
 * tomato into a berry would be worse than the bug being fixed, because it
 * spends the trust that makes the nudge worth having.
 *
 * So corrections are offered only when the **whole** variety name is a plant
 * the catalogue knows outright. That covers her actual row — "Cherry Tomato"
 * is an exact entry — and every packet named after a variety rather than
 * described in a sentence, while declining to have an opinion about the rest.
 */
import type { SeedPacket, Tenderness } from '../types';
import { matchPlant, normalizePlantName, STORAGE_KEYS, tendernessOf } from '@hpt/shared';

/** One packet the catalogue disagrees with, and what accepting would mean. */
export interface CategoryFix {
  /** Stable identity for dismissal, independent of the packet's id. */
  key: string;
  seedId: string;
  variety: string;
  /** The catalogue's canonical name for what she typed. */
  plantName: string;
  storedCategory: string;
  suggestedCategory: string;
  storedTenderness: Tenderness;
  suggestedTenderness: Tenderness;
  /**
   * Whether accepting changes what the frost engine does about this plant.
   *
   * This is the difference between a tidying-up suggestion and a warning she
   * is not getting, and the banner leads with the latter.
   */
  changesFrostAdvice: boolean;
}

/**
 * Identity of one disagreement: this plant, filed this way.
 *
 * Normalised so that refiling "Jalapeño" as "jalapeno" does not resurrect a
 * nudge she has already declined.
 */
export function categoryFixKey(variety: string, storedCategory: string): string {
  return `${normalizePlantName(variety)}|${storedCategory.trim().toLowerCase()}`;
}

/**
 * Every packet whose stored category the catalogue disagrees with.
 *
 * Packets with no category at all are skipped: an empty category is a gap, not
 * a mistake, and the form that creates them now fills it in anyway. So are
 * varieties the catalogue does not recognise outright — silence is the correct
 * answer when you do not know, and a substring match is not knowing (see the
 * header).
 *
 * Ordered so the ones that change frost advice come first, because those are
 * the ones with a deadline.
 */
export function findCategoryFixes(
  seeds: readonly SeedPacket[],
  dismissed: ReadonlySet<string> = new Set(),
): CategoryFix[] {
  const fixes: CategoryFix[] = [];

  for (const packet of seeds) {
    const stored = (packet.category ?? '').trim();
    if (stored === '') continue;

    const match = matchPlant(packet.variety);
    if (!match || match.confidence !== 'exact' || match.entry.category === stored) continue;

    const key = categoryFixKey(packet.variety, stored);
    if (dismissed.has(key)) continue;

    const storedTenderness = tendernessOf(stored);
    const suggestedTenderness = tendernessOf(match.entry.category);

    fixes.push({
      key,
      seedId: packet.id,
      variety: packet.variety,
      plantName: match.entry.name,
      storedCategory: stored,
      suggestedCategory: match.entry.category,
      storedTenderness,
      suggestedTenderness,
      changesFrostAdvice: storedTenderness !== suggestedTenderness,
    });
  }

  return fixes.sort(
    (left, right) =>
      Number(right.changesFrostAdvice) - Number(left.changesFrostAdvice) ||
      left.variety.localeCompare(right.variety),
  );
}

/**
 * The same list of packets with one category changed.
 *
 * Returns a new array with a new packet object; the input is never touched, so
 * an accepted fix flows through the ordinary setState path and syncs like any
 * other edit she makes by hand. An unknown id is returned unchanged rather than
 * throwing — a packet can be deleted in another tab while the banner is open.
 */
export function applyCategoryFix(seeds: readonly SeedPacket[], fix: CategoryFix): SeedPacket[] {
  return seeds.map((packet) =>
    packet.id === fix.seedId ? { ...packet, category: fix.suggestedCategory } : packet,
  );
}

/** Plain-language reason this particular fix is worth her attention. */
export function explainCategoryFix(fix: CategoryFix): string {
  if (!fix.changesFrostAdvice) {
    return `Both are treated the same way for frost. This only tidies up the colour and the rotation reminder.`;
  }

  return fix.suggestedTenderness === 'tender'
    ? `${fix.storedCategory} is treated as frost-hardy, so you are not being warned about this one. ${fix.suggestedCategory} is tender.`
    : `${fix.storedCategory} is treated as tender, so this one is being warned about when it does not need to be. ${fix.suggestedCategory} shrugs off a frost.`;
}

/**
 * Dismissals from `localStorage`, defensively.
 *
 * Any failure — private browsing, quota, corrupt JSON, someone else's value at
 * the same key — means no dismissals rather than no seed vault. A UI preference
 * is never worth throwing from.
 */
export function readDismissals(storage: Storage | undefined): Set<string> {
  if (!storage) return new Set();

  try {
    const raw = storage.getItem(STORAGE_KEYS.dismissedCategoryFixes);
    if (!raw) return new Set();

    const parsed: unknown = JSON.parse(raw);

    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Persists dismissals, silently doing nothing if storage is unavailable. */
export function writeDismissals(storage: Storage | undefined, dismissed: ReadonlySet<string>): void {
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEYS.dismissedCategoryFixes, JSON.stringify([...dismissed]));
  } catch {
    // Nothing to do and nothing worth telling her about.
  }
}
