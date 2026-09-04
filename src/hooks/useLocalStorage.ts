import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * State that mirrors itself into `localStorage`.
 *
 * Reads are lazy and defensive: missing keys, unavailable storage and corrupt
 * JSON all fall back to `initialValue` rather than throwing. Writes are wrapped
 * too, so a full quota can never take the app down.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;

    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return initialValue;
      return JSON.parse(stored) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is unavailable or full; in-memory state stays authoritative.
    }
  }, [key, value]);

  return [value, setValue];
}
