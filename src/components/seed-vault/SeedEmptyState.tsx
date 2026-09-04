import type { LucideIcon } from 'lucide-react';

export interface SeedEmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/** Shared placeholder for "no packets yet" and "nothing matches this filter". */
export function SeedEmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: SeedEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h4 className="mt-4 text-base font-semibold text-stone-900">{title}</h4>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-stone-500">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      >
        {actionLabel}
      </button>
    </div>
  );
}
