import { LayoutGrid, Leaf, Scale, Sprout } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SidebarProps, ViewId } from '../types';

interface NavItem {
  id: ViewId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'planner', label: 'Bed Planner', description: 'Map every square', icon: LayoutGrid },
  { id: 'vault', label: 'Seed Vault', description: 'Packets on hand', icon: Sprout },
  { id: 'harvest', label: 'Harvest Log', description: 'Weigh the yield', icon: Scale },
];

export function Sidebar({ activeView, onChange }: SidebarProps) {
  return (
    <aside className="sticky top-0 flex h-screen w-20 shrink-0 flex-col border-r border-emerald-100/80 bg-white/90 backdrop-blur-md md:w-72">
      <div className="flex items-center gap-3 px-4 py-6 md:px-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/30">
          <Leaf className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="hidden min-w-0 md:block">
          <h1 className="text-base font-bold leading-tight tracking-tight text-stone-900">
            The Home Plot Tracker
          </h1>
          <p className="mt-0.5 text-xs font-medium leading-snug text-stone-500">
            Backyard garden, season by season
          </p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1.5 px-3 md:px-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeView;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={isActive ? 'page' : undefined}
              title={item.label}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white md:px-4 ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="hidden min-w-0 flex-1 md:block">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span
                  className={`block truncate text-xs ${isActive ? 'text-emerald-100' : 'text-stone-500'}`}
                >
                  {item.description}
                </span>
              </span>
              <span className="sr-only md:hidden">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <p className="hidden border-t border-stone-200 px-6 py-4 text-xs text-stone-400 md:block">
        Saved locally on this device
      </p>
    </aside>
  );
}
