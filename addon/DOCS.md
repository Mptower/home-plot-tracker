# The Home Plot Tracker

Plan garden beds, catalogue seed packets and log every harvest, alongside the
rest of your home.

The add-on runs entirely behind Home Assistant ingress. There is no login, no
exposed port and no configuration to fill in — open **Garden** in the sidebar
and it is there.

## Installation

1. **Settings → Add-ons → Add-on Store**.
2. **⋮ → Repositories**, paste `https://github.com/Mptower/home-plot-tracker`
   and select **Add**, then **Close**.
3. Find **The Home Plot Tracker** in the store — it appears in its own section
   at the bottom of the page — and select **Install**. The first install builds
   the image on your machine, so give it a couple of minutes.
4. Turn on **Show in sidebar**, then **Start**. The sidebar entry is a per-install
   setting rather than something the add-on can switch on for you, so this step is
   easy to miss — without it the add-on runs but **Garden** never appears.

## Configuration

Three options, all optional, all with working defaults. They exist so that
renaming something in Home Assistant is a settings change here rather than a
code change.

| Option           | Default                           | What it does                          |
| ---------------- | --------------------------------- | ------------------------------------- |
| `weather_entity` | `weather.forecast_home`           | where the frost forecast is read from |
| `notify_service` | `notify.mobile_app_julie_s_phone` | where a frost warning is sent         |
| `sensor_prefix`  | `garden`                          | prefix for the published sensors      |

`weather_entity` must be an entity that supports forecasts. Most do; if the
frost banner never appears, that is the first thing to check.

`sensor_prefix` only matters if `sensor.garden_harvest_weight` and friends are
already taken. The add-on will not overwrite an entity it did not create — it
logs a line telling you to change this instead.

### Frost notifications and quiet hours moved into the app

As of 0.3.0, three settings that used to be here are no longer on this page:

| Was here              | Now                                             |
| --------------------- | ----------------------------------------------- |
| `frost_notifications` | **Garden → Settings** in the sidebar             |
| `quiet_hours_start`   | **Garden → Settings** in the sidebar             |
| `quiet_hours_end`     | **Garden → Settings** in the sidebar             |

They are stored in the app's own database. Open **Garden → Settings** after
updating and check them once — see the note below about what carries over.

This is a move, not a copy. These settings have exactly one home, and it is the
app. Nothing reads them from this page any more, so re-adding them by hand does
nothing.

#### What carried over, and what did not

Home Assistant rebuilds an add-on's configuration from the options the add-on
currently declares, and drops the ones it no longer does. Because 0.3.0 stops
declaring these three, your old values are usually gone before the app first
starts — so the app starts them at **frost notifications off, quiet hours
21:00–07:00**, which is the same conservative default 0.2.0 documented.

In practice that means:

- If you had notifications **off**, nothing changes.
- If you had them **on**, turn them back on in **Garden → Settings**. The app
  will not start notifying you because of an update you did not ask for; it errs
  towards silence.
- If your quiet hours were something other than 21:00–07:00, set them again.

The add-on log records which of the two happened, on the one start where the
settings are first created.

Two reasons for the move. The first is that changing them here required a
restart, and the app does not: a change on the Settings page is honoured by the
next forecast poll, within a few minutes. The second is that this is an
administrator's screen with entity ids on it, and deciding whether your phone
should buzz before a frost is not an administrator's decision.

What is left here is entity plumbing — set once, at install, and rarely touched
again.

Quiet hours are a floor, not a ceiling: a frost landing within twelve hours will
still notify, because waiting until morning would be too late to cover anything.
The Settings page says so on screen.

Everything else is set by the add-on's entrypoint and is not configurable:

| Setting        | Value       | Why                                                       |
| -------------- | ----------- | --------------------------------------------------------- |
| `DATA_DIR`     | `/data`     | the volume Home Assistant's backups snapshot               |
| `PORT`         | `8099`      | reachable through ingress only, never published to the LAN |
| `BASE_PATH`    | `/`         | ingress strips its own prefix before proxying              |
| `CLIENT_DIR`   | `/app/client` | the built web app inside the image                       |

## Frost warnings and sensors

The add-on reads your weather forecast every fifteen minutes and warns you when
a cold night threatens what you have actually planted — naming the crops and the
bed, rather than just saying "frost".

Which crops are at risk comes from each seed packet's category. Nightshades,
cucurbits, legumes and herbs are treated as tender; brassicas, alliums, roots
and leafy greens as hardy. A category it does not recognise is never guessed at:
it is counted and shown, so the warning tells you how many squares it cannot
speak for.

Three bands, in °F: **frost possible** at 36° or below (plant level runs several
degrees colder than the forecast on a still, clear night), **frost** at 32°, and
**hard freeze** at 28°, where the hardy crops are in trouble too.

Your phone gets at most one notification per cold snap, and a second only if the
forecast gets worse. Nothing is sent at all if nothing tender is in the ground.

Whether a notification is sent at all, and the hours it should stay quiet, are
set in the app: **Garden → Settings**. The same page shows whether Home
Assistant is answering, which entity is being watched and which time zone quiet
hours are read against — which is where to look when no warning appears and you
want to know whether that means "nothing is coming" or "something is broken".

Four sensors are published for dashboards and automations:

- `sensor.garden_harvest_weight` — total harvested, in pounds
- `sensor.garden_harvest_count` — total items harvested
- `sensor.garden_top_variety` — whichever variety has yielded the most weight
- `sensor.garden_frost_risk` — `none`, `advisory`, `frost` or `hard_freeze`

These are created by the add-on at runtime, which means **they disappear if you
restart Home Assistant** and reappear within five minutes when the add-on
re-publishes them. That is a limitation of how add-ons create entities, not a
fault. If a sensor shows `unknown`, the add-on has not managed to read a
forecast yet.

The totals cover every harvest you have logged, matching the "Season so far"
figure in the app itself. The `first_harvest` and `last_harvest` attributes tell
you exactly what span the number covers.

## Your data

Everything lives in one SQLite database at `/data/home-plot-tracker.db`, which
is inside the add-on's persistent volume. **Home Assistant's own backups include
it automatically** — a full or partial backup that covers this add-on covers the
whole garden, and restoring one puts it back.

Stopping the add-on closes the database cleanly, so a backup taken while it is
stopped is a single complete file.

Uninstalling the add-on deletes that volume. Take a backup first if the beds
matter to you.

## There is no authentication, on purpose

Home Assistant's ingress authenticates every request against your HA session
before it ever reaches this add-on, so a second password would be friction with
no benefit. Nothing here is published to your network: the add-on declares no
ports, and its listener is only reachable through the ingress proxy.

That is also why you should not put this behind a plain reverse proxy or forward
its port. Reach it the way it was designed to be reached — through Home
Assistant.

## Troubleshooting

**The build fails.** The image is built on your machine on first install and
needs to reach `registry.npmjs.org` and Docker Hub. Check
**Settings → System → Logs → Supervisor** for the actual error.

**It starts and immediately stops.** Look at the add-on's **Log** tab. A healthy
start looks like this:

```
[home-plot-tracker] starting on :8099, data in /data
Database: /data/home-plot-tracker.db (journal_mode=wal)
Applied migrations: 1, 2, 3, 4 (schema version 4)
The Home Plot Tracker API is listening on http://0.0.0.0:8099/
Serving the client bundle from /app/client
```

**It is not in the sidebar.** Open the add-on page and turn on **Show in
sidebar**.

## Support

Issues and pull requests: <https://github.com/Mptower/home-plot-tracker>
