/**
 * Pure helpers behind the Settings view.
 *
 * Nothing here touches React or the network, so the rules that are easy to get
 * subtly wrong — what a quiet-hours window actually means, when it is switched
 * off, when a frost is close enough to override it — are all testable on their
 * own.
 *
 * These helpers exist mostly to produce *sentences*. The server's behaviour
 * here is genuinely surprising if nobody explains it: a window with equal
 * bounds does nothing at all, and a notification arrives during quiet hours
 * anyway when the frost is close. Both are correct, and both look exactly like
 * bugs the first time you meet them. Saying so on the page is cheaper than
 * being asked about it at 3am.
 */
import type { GardenSettings, IntegrationStatusBody } from '../types';

/**
 * What the server falls back to, mirrored here for the first paint only.
 *
 * The server is the source of truth; this is what the form shows for the
 * fraction of a second before the real answer arrives, so that the controls are
 * never rendered blank or disabled-looking.
 */
export const SETTINGS_FALLBACK: GardenSettings = {
  frostNotifications: true,
  quietHoursStart: '21:00',
  quietHoursEnd: '07:00',
};

/**
 * A frost this close notifies even inside quiet hours.
 *
 * Mirrors `URGENT_WITHIN_HOURS` in `server/src/ha/notifier.ts`. It is a number
 * in prose on this page rather than a fetched value because it is part of an
 * explanation, not a setting — and a sentence that said "within the configured
 * urgency window" would explain nothing.
 */
export const URGENT_WITHIN_HOURS = 12;

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY.test(value);
}

/** Minutes from local midnight. `-1` for anything that is not a time. */
export function toMinutes(value: string): number {
  const match = TIME_OF_DAY.exec(value);

  if (!match) return -1;

  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * `21:00` as `9:00 PM`, in her locale.
 *
 * `<input type="time">` shows whatever the browser's locale dictates, so the
 * prose around it has to agree rather than quoting a 24-hour string back at
 * somebody whose clock reads twelve-hour.
 */
export function formatTime(value: string): string {
  if (!isTimeOfDay(value)) return value;

  const [hours, minutes] = value.split(':').map(Number);
  const when = new Date();

  when.setHours(hours ?? 0, minutes ?? 0, 0, 0);

  return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Quiet hours are off when the two bounds are the same instant. */
export function quietHoursDisabled(settings: GardenSettings): boolean {
  return settings.quietHoursStart === settings.quietHoursEnd;
}

/** True when the window runs through midnight, which is the usual case. */
export function quietHoursWrapMidnight(settings: GardenSettings): boolean {
  return toMinutes(settings.quietHoursStart) > toMinutes(settings.quietHoursEnd);
}

/**
 * One sentence describing exactly what the current window will do.
 *
 * Written to be read aloud. The disabled case is called out in as many words
 * because setting both boxes to the same time is otherwise a silent no-op, and
 * a control that appears to do nothing is worse than one that is missing.
 */
export function describeQuietHours(settings: GardenSettings): string {
  if (!settings.frostNotifications) {
    return 'Frost notifications are switched off, so quiet hours make no difference right now.';
  }

  if (!isTimeOfDay(settings.quietHoursStart) || !isTimeOfDay(settings.quietHoursEnd)) {
    return 'Set both times to decide when a warning should wait until morning.';
  }

  if (quietHoursDisabled(settings)) {
    return 'Quiet hours are off: both times are the same, so a frost warning can arrive at any hour.';
  }

  const start = formatTime(settings.quietHoursStart);
  const end = formatTime(settings.quietHoursEnd);
  const overnight = quietHoursWrapMidnight(settings) ? ' overnight' : '';

  return `Between ${start} and ${end}${overnight}, a frost warning waits until ${end} — unless the frost is less than ${URGENT_WITHIN_HOURS} hours away.`;
}

/** True once every field is something the server will accept. */
export function isValidSettings(settings: GardenSettings): boolean {
  return isTimeOfDay(settings.quietHoursStart) && isTimeOfDay(settings.quietHoursEnd);
}

export function settingsEqual(a: GardenSettings, b: GardenSettings): boolean {
  return (
    a.frostNotifications === b.frostNotifications &&
    a.quietHoursStart === b.quietHoursStart &&
    a.quietHoursEnd === b.quietHoursEnd
  );
}

/**
 * A settings object out of an unknown response body, or `null`.
 *
 * The same defensive reading the rest of the client does: a server that answers
 * with something unexpected should leave the form alone rather than filling it
 * with `undefined`.
 */
export function readSettingsBody(value: unknown): GardenSettings | null {
  if (typeof value !== 'object' || value === null) return null;

  const body = value as Partial<GardenSettings>;

  if (typeof body.frostNotifications !== 'boolean') return null;
  if (typeof body.quietHoursStart !== 'string' || !isTimeOfDay(body.quietHoursStart)) return null;
  if (typeof body.quietHoursEnd !== 'string' || !isTimeOfDay(body.quietHoursEnd)) return null;

  return {
    frostNotifications: body.frostNotifications,
    quietHoursStart: body.quietHoursStart,
    quietHoursEnd: body.quietHoursEnd,
  };
}

export type ConnectionTone = 'ok' | 'warn' | 'quiet';

export interface ConnectionSummary {
  tone: ConnectionTone;
  label: string;
  /** The sentence that tells her whether to worry. */
  detail: string;
}

/**
 * Whether Home Assistant is working, in words rather than a status code.
 *
 * The distinction this exists to draw is "broken" versus "nothing to report".
 * Both look identical from the garden — no frost banner — and only one of them
 * is worth telling Matt about.
 */
export function summarizeConnection(status: IntegrationStatusBody | null): ConnectionSummary {
  if (status === null) {
    return {
      tone: 'quiet',
      label: 'Checking',
      detail: 'Asking the garden server about Home Assistant.',
    };
  }

  if (!status.configured) {
    return {
      tone: 'quiet',
      label: 'Not connected',
      detail:
        'This copy of the app is not running as a Home Assistant add-on, so there is no forecast to watch and no way to send a notification.',
    };
  }

  if (!status.connected) {
    return {
      tone: 'warn',
      label: 'Not answering',
      detail:
        'Home Assistant is configured but is not responding. Frost warnings will not arrive until it is back. Your garden is unaffected.',
    };
  }

  if (status.reason === 'no_forecast') {
    return {
      tone: 'warn',
      label: 'No forecast yet',
      detail: `Connected, but nothing has been read from ${status.weatherEntity ?? 'the weather entity'} yet. This is normal for the first minute after a restart.`,
    };
  }

  return {
    tone: 'ok',
    label: 'Connected',
    detail: 'Home Assistant is answering and the forecast is being watched.',
  };
}

const FROST_RISK_LABELS: Record<string, string> = {
  none: 'None forecast',
  advisory: 'Frost possible',
  frost: 'Frost',
  hard_freeze: 'Hard freeze',
};

/**
 * The current frost risk as a phrase.
 *
 * `none` is a real answer — it means a forecast was read and nothing planted
 * minds the low — so it must not render the same as "we have no idea".
 */
export function describeFrostRisk(status: IntegrationStatusBody | null): string {
  if (status === null || status.frostRisk === null) return 'Not known yet';

  return FROST_RISK_LABELS[status.frostRisk] ?? status.frostRisk;
}

/** "3 minutes ago", for the last time the forecast was read. */
export function describeObservedAt(observedAt: string | null, now = new Date()): string {
  if (observedAt === null) return 'Never';

  const at = new Date(observedAt);

  if (Number.isNaN(at.getTime())) return 'Never';

  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));

  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);

  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  return at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
}
