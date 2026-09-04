# Changelog

## 0.1.0

First release.

- Runs the whole app — API and web client — in one Node process behind Home
  Assistant ingress, with no login and no exposed port.
- Stores the garden in SQLite at `/data/home-plot-tracker.db`, so Home
  Assistant's own backups include it.
- Adds a **Garden** panel to the sidebar.
- Builds for `amd64` and `aarch64`.
