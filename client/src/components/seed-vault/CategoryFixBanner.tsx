/**
 * The gentle offer to correct a packet filed under the wrong family.
 *
 * Indigo rather than rose or amber on purpose: those two are already spoken for
 * by stale packets and rotation warnings, and this is not a warning. It is also
 * the one hue no category uses, so a banner can never be mistaken for a family
 * chip. Nothing is wrong with her garden — something is wrong with one line of
 * one record, and the app is asking rather than telling.
 *
 * Every offer shows what it would change, and what that change is worth. The
 * frost sentence is the point: "filed as a Leafy Green, which is treated as
 * frost-hardy, so you are not being warned about it" is a reason. "Tomatoes are
 * nightshades" is trivia.
 */
import { Check, Wand2, X } from 'lucide-react';
import { explainCategoryFix } from '../../lib/categoryFix';
import type { CategoryFix } from '../../lib/categoryFix';
import { getCategoryStyle } from '../../lib/rotation';

export interface CategoryFixBannerProps {
  fixes: CategoryFix[];
  onApply: (fix: CategoryFix) => void;
  onDismiss: (fix: CategoryFix) => void;
}

export function CategoryFixBanner({ fixes, onApply, onDismiss }: CategoryFixBannerProps) {
  if (fixes.length === 0) return null;

  return (
    <section
      aria-labelledby="category-fix-heading"
      className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4"
    >
      <h3
        id="category-fix-heading"
        className="flex items-center gap-2 text-sm font-semibold text-indigo-900"
      >
        <Wand2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        {fixes.length === 1
          ? 'One packet looks filed under the wrong category'
          : `${fixes.length} packets look filed under the wrong category`}
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-indigo-800">
        Nothing has been changed. The category decides how the frost warning treats a plant, so
        these are worth a look — but they are your records, and these buttons are the only thing
        that will touch them.
      </p>

      <ul className="mt-4 space-y-2">
        {fixes.map((fix) => {
          const storedStyle = getCategoryStyle(fix.storedCategory);
          const suggestedStyle = getCategoryStyle(fix.suggestedCategory);

          return (
            <li
              key={fix.key}
              className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border border-indigo-200 bg-panel px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-900">
                  {fix.variety} is usually a {fix.suggestedCategory}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${storedStyle.chip}`}>
                    <span className={`h-2 w-2 rounded-full ${storedStyle.swatch}`} aria-hidden="true" />
                    {fix.storedCategory}
                  </span>
                  <span aria-hidden="true">→</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${suggestedStyle.chip}`}>
                    <span className={`h-2 w-2 rounded-full ${suggestedStyle.swatch}`} aria-hidden="true" />
                    {fix.suggestedCategory}
                  </span>
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
                  {explainCategoryFix(fix)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onApply(fix)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Change it to {fix.suggestedCategory}
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(fix)}
                  aria-label={`Keep ${fix.variety} as a ${fix.storedCategory}`}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-stone-600 transition-colors hover:bg-panel-sunken hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Keep mine
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
