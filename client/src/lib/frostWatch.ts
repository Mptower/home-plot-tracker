/**
 * Asking the server what Home Assistant knows.
 *
 * This never talks to Home Assistant. It talks to one small endpoint on our own
 * server, which holds the credential and does the polling. The browser is given
 * only what the banner draws.
 *
 * The one rule here is that **failure is silence**. No Home Assistant, a
 * server too old to have this endpoint, a dropped connection, a body that isn't
 * what we expect — all of it resolves to `null` and the banner renders nothing.
 * There is no error state, because a garden app on a laptop with no Home
 * Assistant is not in an error state; it is in its ordinary one.
 */
import type { FrostWatch, HomeAssistantBody } from '../types';
import { apiUrl } from './api';

/** Long enough for a local server, short enough never to feel like a hang. */
const TIMEOUT_MS = 5_000;

function isFrostWatch(value: unknown): value is FrostWatch {
  if (typeof value !== 'object' || value === null) return false;

  const watch = value as Partial<FrostWatch>;

  return (
    typeof watch.severity === 'string' &&
    typeof watch.lowF === 'number' &&
    typeof watch.eventKey === 'string' &&
    Array.isArray(watch.bedsAtRisk)
  );
}

/**
 * The current frost watch, or `null` for every reason there might not be one.
 *
 * Deliberately does not distinguish "no Home Assistant" from "no frost coming":
 * both render nothing, so collapsing them here means the component has one case
 * to handle instead of four.
 */
export async function fetchFrostWatch(signal?: AbortSignal): Promise<FrostWatch | null> {
  try {
    const response = await fetch(apiUrl('home-assistant'), {
      headers: { Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as HomeAssistantBody;

    if (!body?.available) return null;

    return isFrostWatch(body.frost) ? body.frost : null;
  } catch {
    return null;
  }
}
