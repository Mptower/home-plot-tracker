/**
 * The frost watch, kept current in the background.
 *
 * Polls every ten minutes and once on mount. Ten rather than one because the
 * server only re-reads the forecast every fifteen, so anything faster is asking
 * a cache the same question repeatedly; and the thing being watched is a
 * tomorrow-night frost, not a live meter.
 *
 * **It never reports failure.** There is no `error` and no `isLoading` in what
 * this returns, because there is nothing sensible for the UI to do with either.
 * A frost watch that cannot be fetched is indistinguishable, to a gardener,
 * from no frost being forecast — so both are `null` and the banner is simply
 * not there.
 *
 * Note it does not lean on conditional requests. A browser `fetch()` carrying
 * `If-None-Match` is downgraded by the Fetch specification to cache mode
 * `no-store` with `Cache-Control: no-cache`, and Express honours that by
 * refusing to answer `304` — so a client that expected `304`s would silently
 * never get one. The payload is a few hundred bytes; re-reading it is cheaper
 * than being clever about it.
 */
import { useEffect, useState } from 'react';
import type { FrostWatch } from '../types';
import { fetchFrostWatch } from '../lib/frostWatch';

const POLL_INTERVAL_MS = 10 * 60 * 1000;

export function useFrostWatch(): FrostWatch | null {
  const [watch, setWatch] = useState<FrostWatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const poll = async (): Promise<void> => {
      const next = await fetchFrostWatch(controller.signal);

      // A late response from a poll started before unmount must not write into
      // a component that is gone.
      if (!cancelled) setWatch(next);
    };

    void poll();

    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return watch;
}
