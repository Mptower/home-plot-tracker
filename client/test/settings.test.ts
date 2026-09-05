/**
 * The sentences the Settings page shows, and the rules behind them.
 *
 * Two behaviours the server has are genuinely surprising, and both look exactly
 * like bugs the first time you meet them: quiet hours with equal bounds do
 * nothing at all, and a notification arrives during quiet hours anyway when the
 * frost is close. The page is the only place either is ever explained, so these
 * tests are about the explanation being present and correct — not about
 * decoration.
 *
 * Nothing here asserts on a locale-formatted time. `toLocaleTimeString` renders
 * differently on a machine set to a 24-hour clock, and a test that pinned
 * "9:00 PM" would fail on hers rather than on ours.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GardenSettings, IntegrationStatusBody } from '@hpt/shared';

import {
  SETTINGS_FALLBACK,
  URGENT_WITHIN_HOURS,
  describeFrostRisk,
  describeObservedAt,
  describeQuietHours,
  isTimeOfDay,
  isValidSettings,
  quietHoursDisabled,
  quietHoursWrapMidnight,
  readSettingsBody,
  settingsEqual,
  summarizeConnection,
  toMinutes,
} from '../src/lib/settings.ts';

/**
 * A settings object for the wording tests.
 *
 * Deliberately an explicit base rather than a spread of `SETTINGS_FALLBACK`.
 * Most of these tests are about how a quiet-hours window is described, which
 * only has anything to say while notifications are on — and a fixture built
 * from a product default silently changes meaning the day that default flips,
 * which is exactly how a real bug once hid here.
 */
function settings(overrides: Partial<GardenSettings> = {}): GardenSettings {
  return {
    frostNotifications: true,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
    ...overrides,
  };
}

function status(overrides: Partial<IntegrationStatusBody> = {}): IntegrationStatusBody {
  return {
    configured: true,
    connected: true,
    reason: null,
    weatherEntity: 'weather.forecast_home',
    notifyService: 'notify.mobile_app_julie_s_phone',
    sensors: ['sensor.garden_frost_risk'],
    timeZone: 'America/Chicago',
    frostRisk: 'none',
    forecastObservedAt: null,
    ...overrides,
  };
}

test('a time is HH:MM on a 24-hour clock, and nothing else', () => {
  for (const good of ['00:00', '07:00', '21:00', '23:59', '09:05']) {
    assert.equal(isTimeOfDay(good), true, good);
  }

  // `<input type="time">` can hand back an empty string, and a half-typed
  // value passes through the field on the way to a real one.
  for (const bad of ['', '9pm', '24:00', '21:60', '7:00', '21:0', 'noon']) {
    assert.equal(isTimeOfDay(bad), false, bad);
  }
});

test('minutes are counted from local midnight', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('07:00'), 420);
  assert.equal(toMinutes('21:30'), 1290);
  assert.equal(toMinutes('nonsense'), -1);
});

test('equal quiet hours mean quiet hours are off', () => {
  assert.equal(quietHoursDisabled(settings({ quietHoursStart: '07:00', quietHoursEnd: '07:00' })), true);
  assert.equal(quietHoursDisabled(settings()), false);
});

test('a window that starts after it ends runs through midnight', () => {
  assert.equal(quietHoursWrapMidnight(settings({ quietHoursStart: '21:00', quietHoursEnd: '07:00' })), true);
  assert.equal(quietHoursWrapMidnight(settings({ quietHoursStart: '13:00', quietHoursEnd: '15:00' })), false);
});

test('the quiet-hours sentence says outright when the window does nothing', () => {
  const sentence = describeQuietHours(
    settings({ quietHoursStart: '07:00', quietHoursEnd: '07:00' }),
  );

  // Setting both boxes the same is otherwise a silent no-op, and a control that
  // appears to do nothing is worse than one that is missing.
  assert.match(sentence, /quiet hours are off/i);
  assert.match(sentence, /any hour/i);
});

test('the quiet-hours sentence explains the twelve-hour override', () => {
  const sentence = describeQuietHours(settings());

  assert.match(sentence, new RegExp(`${URGENT_WITHIN_HOURS} hours`));
  assert.match(sentence, /unless/i);
});

test('an overnight window is described as overnight', () => {
  assert.match(describeQuietHours(settings()), /overnight/);
  assert.doesNotMatch(
    describeQuietHours(settings({ quietHoursStart: '13:00', quietHoursEnd: '15:00' })),
    /overnight/,
  );
});

test('with notifications off, the quiet-hours sentence says it makes no difference', () => {
  const sentence = describeQuietHours(settings({ frostNotifications: false }));

  assert.match(sentence, /switched off/i);
  assert.doesNotMatch(sentence, /waits until/i);
});

test('a half-typed time is described without pretending to know what it means', () => {
  const sentence = describeQuietHours(settings({ quietHoursStart: '21:0' }));

  assert.match(sentence, /set both times/i);
});

test('only a complete pair of real times is saveable', () => {
  assert.equal(isValidSettings(settings()), true);
  assert.equal(isValidSettings(settings({ quietHoursStart: '' })), false);
  assert.equal(isValidSettings(settings({ quietHoursEnd: '25:00' })), false);

  // Equal bounds are a supported choice, not a validation failure.
  assert.equal(
    isValidSettings(settings({ quietHoursStart: '07:00', quietHoursEnd: '07:00' })),
    true,
  );
});

test('the first paint cannot show notifications as on before the server answers', () => {
  // The fallback is what the toggle renders for the moment before the real
  // settings arrive. If it were `true` the switch would flash on for someone
  // who has notifications off, which reads as "the update turned this back on".
  // It must also track DEFAULT_SETTINGS in server/src/db/settings.ts.
  assert.equal(SETTINGS_FALLBACK.frostNotifications, false);
  assert.equal(SETTINGS_FALLBACK.quietHoursStart, '21:00');
  assert.equal(SETTINGS_FALLBACK.quietHoursEnd, '07:00');
});

test('two settings are equal when all three fields are', () => {
  assert.equal(settingsEqual(settings(), settings()), true);
  assert.equal(settingsEqual(settings(), settings({ frostNotifications: false })), false);
  assert.equal(settingsEqual(settings(), settings({ quietHoursEnd: '06:00' })), false);
});

test('a settings body is read defensively', () => {
  assert.deepEqual(
    readSettingsBody({ frostNotifications: false, quietHoursStart: '22:00', quietHoursEnd: '06:00' }),
    { frostNotifications: false, quietHoursStart: '22:00', quietHoursEnd: '06:00' },
  );

  // Anything the form could not honestly render leaves it alone instead.
  assert.equal(readSettingsBody(null), null);
  assert.equal(readSettingsBody('off'), null);
  assert.equal(readSettingsBody({ frostNotifications: 'yes', quietHoursStart: '21:00', quietHoursEnd: '07:00' }), null);
  assert.equal(readSettingsBody({ frostNotifications: true, quietHoursStart: '9pm', quietHoursEnd: '07:00' }), null);
  assert.equal(readSettingsBody({ frostNotifications: true, quietHoursStart: '21:00' }), null);
});

test('a healthy integration reads as connected', () => {
  const summary = summarizeConnection(status());

  assert.equal(summary.tone, 'ok');
  assert.match(summary.label, /connected/i);
});

test('no Home Assistant is calm, not an error', () => {
  const summary = summarizeConnection(status({ configured: false, connected: false, reason: 'not_configured' }));

  assert.equal(summary.tone, 'quiet', 'a laptop with no Home Assistant is in its ordinary state');
  assert.match(summary.detail, /not running as a Home Assistant add-on/i);
});

test('a configured but unreachable Home Assistant is the case worth flagging', () => {
  const summary = summarizeConnection(status({ connected: false, reason: 'unreachable' }));

  assert.equal(summary.tone, 'warn');
  // The reassurance matters as much as the warning: the garden still works.
  assert.match(summary.detail, /garden is unaffected/i);
});

test('connected but not yet polled is distinguished from broken', () => {
  const summary = summarizeConnection(status({ reason: 'no_forecast', frostRisk: null }));

  assert.equal(summary.tone, 'warn');
  assert.match(summary.detail, /normal for the first minute/i);
});

test('nothing known yet says so rather than guessing', () => {
  assert.equal(summarizeConnection(null).tone, 'quiet');
});

test('"none" is an answer, and a different one from "not known"', () => {
  // September in Chicago, lowest forecast low 71°F. `none` is correct, and
  // rendering it the same as "no idea" is what would make this panel useless.
  assert.equal(describeFrostRisk(status({ frostRisk: 'none' })), 'None forecast');
  assert.equal(describeFrostRisk(status({ frostRisk: null })), 'Not known yet');
  assert.equal(describeFrostRisk(null), 'Not known yet');
  assert.equal(describeFrostRisk(status({ frostRisk: 'hard_freeze' })), 'Hard freeze');
});

test('the last forecast read is described in plain relative time', () => {
  const now = new Date('2026-09-20T12:00:00Z');

  assert.equal(describeObservedAt(null, now), 'Never');
  assert.equal(describeObservedAt('not a date', now), 'Never');
  assert.equal(describeObservedAt('2026-09-20T11:59:40Z', now), 'Just now');
  assert.equal(describeObservedAt('2026-09-20T11:59:00Z', now), '1 minute ago');
  assert.equal(describeObservedAt('2026-09-20T11:43:00Z', now), '17 minutes ago');
  assert.equal(describeObservedAt('2026-09-20T11:00:00Z', now), '1 hour ago');
  assert.equal(describeObservedAt('2026-09-20T06:00:00Z', now), '6 hours ago');
});
