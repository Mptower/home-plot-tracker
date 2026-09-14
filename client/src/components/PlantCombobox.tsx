/**
 * The searchable plant field.
 *
 * She types "jalap", sees Jalapeno, picks it, and the category is filled in for
 * her. She can also ignore the list entirely and type whatever she likes — the
 * catalogue is an offer, never a gate. Free text has always worked here and
 * still does, because a seed packet from a neighbour's kitchen table is a real
 * thing that must stay recordable.
 *
 * Keyboard behaviour follows the standard combobox pattern: arrows move,
 * wrapping at both ends; Enter takes the highlighted option; Escape closes the
 * list without changing what she typed; Tab leaves the field. The list is only
 * announced to screen readers when it is actually open.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Search, Sprout } from 'lucide-react';
import type { SeedPacket } from '../types';
import { getCategoryStyle } from '../lib/rotation';
import { moveHighlight, suggestVarieties } from '../lib/plantSuggest';
import type { PlantSuggestion } from '../lib/plantSuggest';

export interface PlantComboboxProps {
  id: string;
  value: string;
  /** Free text: she typed, nothing was chosen, the category is left alone. */
  onChange: (variety: string) => void;
  /** A suggestion was taken, so the caller may fill in the category. */
  onPick: (suggestion: PlantSuggestion) => void;
  /** Her own packets, offered ahead of the catalogue. Pass `[]` for none. */
  seeds: readonly SeedPacket[];
  placeholder?: string;
  className?: string;
  /** Rendered with a magnifier rather than a plain text field. */
  withSearchIcon?: boolean;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  limit?: number;
}

export function PlantCombobox({
  id,
  value,
  onChange,
  onPick,
  seeds,
  placeholder,
  className = '',
  withSearchIcon = false,
  invalid = false,
  describedBy,
  required = false,
  limit = 8,
}: PlantComboboxProps) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const suggestions = useMemo(
    () => (value.trim() === '' ? [] : suggestVarieties(value, seeds, { limit })),
    [value, seeds, limit],
  );

  // A stale highlight would let Enter pick a row that is no longer the row she
  // is looking at, which is the one mistake a combobox must never make.
  useEffect(() => setHighlight(-1), [value]);

  // Clicking anywhere else closes the list. Pointer-down rather than click, so
  // the list is gone before whatever she clicked reacts.
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  const isListVisible = isOpen && suggestions.length > 0;

  function choose(suggestion: PlantSuggestion) {
    onPick(suggestion);
    setIsOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setHighlight((current) => moveHighlight(current, suggestions.length, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }

    if (event.key === 'Enter' && isListVisible && highlight >= 0) {
      const suggestion = suggestions[highlight];
      if (!suggestion) return;
      // Only swallow the Enter when it is actually taking a suggestion,
      // otherwise she could never submit the form from this field.
      event.preventDefault();
      choose(suggestion);
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      // Kept local: inside the plant picker modal this would otherwise close
      // the whole dialog, losing the square she was planting.
      event.stopPropagation();
      setIsOpen(false);
      setHighlight(-1);
      return;
    }

    if (event.key === 'Tab') setIsOpen(false);
  }

  const activeId = highlight >= 0 && isListVisible ? `${listId}-option-${highlight}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      {withSearchIcon && (
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          aria-hidden="true"
        />
      )}
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={isListVisible}
        aria-controls={isListVisible ? listId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        className={className}
      />

      {isListVisible && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Plant suggestions"
          className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-panel-edge bg-panel py-1 shadow-lg"
        >
          {suggestions.map((suggestion, index) => {
            const style = getCategoryStyle(suggestion.category);
            const isHighlighted = index === highlight;

            return (
              <li key={suggestion.key} id={`${listId}-option-${index}`} role="option" aria-selected={isHighlighted}>
                <button
                  type="button"
                  tabIndex={-1}
                  // Pointer-down rather than click: a click fires after blur,
                  // by which time the list has already closed underneath her.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(suggestion);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    isHighlighted ? 'bg-emerald-50' : 'bg-transparent hover:bg-emerald-50/60'
                  }`}
                >
                  <span className={`h-7 w-7 shrink-0 rounded-lg ${style.swatch}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-stone-900">
                      {suggestion.variety}
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      {suggestion.category}
                      {suggestion.detail !== '' && ` · ${suggestion.detail}`}
                    </span>
                  </span>
                  {suggestion.source === 'vault' && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800"
                      title="Already in your seed vault"
                    >
                      <Sprout className="h-3 w-3" aria-hidden="true" />
                      In vault
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
