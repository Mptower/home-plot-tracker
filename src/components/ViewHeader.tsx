import type { LucideIcon } from 'lucide-react';

export interface ViewHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Section header shared by every feature view so headings stay consistent. */
export function ViewHeader({ icon: Icon, title, description }: ViewHeaderProps) {
  return (
    <header className="flex items-start gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">{title}</h2>
        <p className="mt-1 text-sm text-stone-500">{description}</p>
      </div>
    </header>
  );
}
