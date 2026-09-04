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

None. Every knob the server has is set by the add-on's entrypoint:

| Setting        | Value       | Why                                                       |
| -------------- | ----------- | --------------------------------------------------------- |
| `DATA_DIR`     | `/data`     | the volume Home Assistant's backups snapshot               |
| `PORT`         | `8099`      | reachable through ingress only, never published to the LAN |
| `BASE_PATH`    | `/`         | ingress strips its own prefix before proxying              |
| `CLIENT_DIR`   | `/app/client` | the built web app inside the image                       |

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
Applied migrations: 1 (schema version 1)
The Home Plot Tracker API is listening on http://0.0.0.0:8099/
Serving the client bundle from /app/client
```

**It is not in the sidebar.** Open the add-on page and turn on **Show in
sidebar**.

## Support

Issues and pull requests: <https://github.com/Mptower/home-plot-tracker>
