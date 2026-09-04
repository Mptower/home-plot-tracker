# Changelog

## 0.3.0

Frost settings move into the app.

- **A Settings page in the Garden panel.** Frost notifications and quiet hours
  are now changed from inside the app, alongside the beds and the harvest log,
  instead of from the add-on's Configuration tab.
- **Changes apply immediately.** Turning notifications on or off, or moving
  quiet hours, is honoured within a few minutes. There is no longer anything
  to restart.
- **Your current settings carry over.** Whatever you last saved in the
  Configuration tab is what the Settings page opens with — this update does
  not reset anything.
- **The page explains itself.** It says in plain words that a frost less than
  twelve hours away is announced even during quiet hours, and that setting
  both times to the same value switches quiet hours off. Neither was ever
  written down anywhere you would look.
- **A status panel** shows whether Home Assistant is answering, which weather
  entity is being watched, which sensors are published and which time zone
  quiet hours are read against. It is there for when no frost warning appears
  and you want to know whether that means "nothing is coming" or "something is
  broken".
- The Configuration tab now holds only the entity plumbing — weather entity,
  notify service, sensor prefix — which is set once and rarely touched. Frost
  notifications and quiet hours are no longer there, deliberately: two
  settings pages that disagree is worse than one that is slightly further
  away.

## 0.2.0

Connects the garden to the rest of Home Assistant.

- **Frost warnings.** Reads the forecast from your weather entity and shows a
  banner in the app when a frost is coming, with the night and the coldest
  hour. Tender crops you have actually planted are named, so an empty bed
  never raises an alarm.
- **Four sensors**, published as `sensor.garden_*`: harvest weight, harvest
  count, top variety and frost risk. Usable in your own dashboards and
  automations.
- **Optional phone notification** for frost, with quiet hours so it will not
  wake you — unless the frost is within twelve hours, when morning would be
  too late to cover anything. **Off by default**; turn it on in the add-on's
  Configuration tab.
- Weather entity, notify service and sensor prefix are all settings rather
  than constants, so renaming an entity in Home Assistant does not need a new
  release. A bad entity id logs a warning and the garden still loads.
- Needs the Home Assistant API, which this version requests for the first
  time. Nothing reaches the browser: the token stays server-side and the app
  is given only what it needs to draw the banner.
- The app works exactly as before if the integration is unavailable or
  switched off. Nothing here is required to plan a bed or log a harvest.

## 0.1.0

First release.

- Runs the whole app — API and web client — in one Node process behind Home
  Assistant ingress, with no login and no exposed port.
- Stores the garden in SQLite at `/data/home-plot-tracker.db`, so Home
  Assistant's own backups include it.
- Adds a **Garden** panel to the sidebar.
- Builds for `amd64` and `aarch64`.
