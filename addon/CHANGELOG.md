# Changelog

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
