# Zenoh Supervisor (draft)

Read-only dashboard to watch one or more devices (robots, servers, anything that
speaks Zenoh) from the browser. React + Vite + Tailwind + `@eclipse-zenoh/zenoh-ts`.

## Install

### Desktop app (recommended)

Download the installer for your system from the
[Releases page](https://github.com/ThomasDuvinage/zenoh-supervisor/releases):

| System | File |
| --- | --- |
| Linux | `.deb`, `.rpm` or `.AppImage` |
| Windows | `.msi` or `-setup.exe` |
| macOS (Apple silicon) | `aarch64.dmg` |
| macOS (Intel) | `x64.dmg` |

The installers are not code-signed yet, so the first launch shows a warning:
macOS: right-click the app, then **Open**. Windows SmartScreen: **More info**, then **Run anyway**.
On Linux, `chmod +x` the AppImage before running it.

The app bundles `zenohd` and the remote-api plugin, so you do not need to install Zenoh.

### Web version

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/, serve with any web server
```

The browser cannot open raw Zenoh TCP (port 7447), so it needs a router running the
**zenoh-plugin-remote-api** bridge. The stock `eclipse/zenoh` image does not include it.

## Usage

1. **Get a router with the bridge.** Either:
   - desktop app: click **Start local router** in the sidebar and pick a Zenoh config
     (try `examples/single-router/router.json5`). The app starts the bundled `zenohd`
     and adds a connection to its WebSocket port for you; or
   - run your own: `zenohd -c router.json5` with `plugins: { remote_api: { websocket_port: "10000" } }`.
2. **Add a device.** Use **Add device** with a name and the bridge URL (`ws://host:10000`).
   Connections can be grouped, auto-connect on start, and are read-only by default.
3. **Subscribe.** Open the device and add key expressions, e.g. `robot1/sensors/**`
   (data) or `devices/*/alive` (liveliness). Set a unit, min/max and a stale timeout to get
   out-of-range and stale flags.
4. **Watch.** The Overview shows every connection and the merged network graph; each device
   has tabs for live values, log, queries, topology and (if you turn read-only off) publish.
5. **Save your setup.** Import, export or reset the config from the sidebar buttons (see Config).

Try it without hardware: follow [examples/single-router](examples/single-router/README.md)
(one router, one fake robot) or [examples/two-routers](examples/two-routers/README.md).

## Config

Defaults come from `public/supervisor.config.json` on first start, then live in
the browser's localStorage. Edit them from the UI, or use the sidebar buttons to
import / export / reset to the file.

```jsonc
{
  "version": 1,
  "devices": [{
    "id": "robot1", "name": "Robot 1", "url": "ws://10.0.0.5:10000",
    "group": "Fleet A", "autoConnect": true,
    "readOnly": true,                       // hides the Publish tab
    "subscriptions": [
      { "id": "s1", "keyexpr": "robot1/sensors/**", "kind": "data",
        "unit": "°C", "min": 0, "max": 80, "staleAfterSec": 5 },
      { "id": "s2", "keyexpr": "robot1/*/alive", "kind": "liveliness" }
    ]
  }]
}
```

## What it does

- Several connections at once, added or removed on the fly; auto-reconnect with backoff.
- Per connection: subscribe to any key expression (data or liveliness), add/remove live.
- Overview: status, topic count, msg/s, devices alive, stale and out-of-range counts.
- Live table: latest value, sparkline, rate, age, `stale` / out-of-range flags.
- Liveliness: who is online, no heartbeat messages needed.
- Log with filter and JSON export; pause and clear.
- Queries tab: `get` on any selector (device info, config, version) and show every reply, with timing and error replies.
- Topology tab: the routers and peers the bridge is linked to (zid, role, link locators), live on transport/link events. Overview merges all connections into one network graph, joined on zid. A bridge only sees its direct neighbours; connect to more routers to see more.
- Read-only by default; Publish tab only when you turn it off.

## Latency (passive)

Subscriptions can have a latency source: the Zenoh message timestamp, an attachment
holding an epoch number, or a field of a JSON payload (epoch number or ISO date).
latency = browser receive time - send time. Nothing is published or queried, so it
adds no traffic and cannot delay the devices; stats are computed on the UI tick, not per message.

- Epoch numbers are UTC, so timezones don't matter. ISO strings without a timezone are read
  as UTC by default (setting: UTC or browser-local); `Date.parse` alone would use the browser's zone.
- Clocks out of sync: the delay is a one-way delay, so a constant offset shifts it.
  Use **Relative** mode (delay above the lowest seen), or a per-subscription clock offset
  (type it, or **Align** to set it from the lowest delay seen). Offsets are per emitter,
  because each subscription usually maps to a different clock.
- It measures emitter -> this browser, including the bridge and WebSocket hop: a proxy for
  the delay your real consumer sees, not the same thing.

## Ideas not built yet

- Alert rules with notifications (browser notification, webhook) and an alert history.
- Longer history with real charts (uPlot/Recharts), CSV export, time range picker.
- Message size and bandwidth per topic; latency from payload timestamps.
- Payload decoders per subscription (JSON path, protobuf, CDR for ROS 2).
- Image topics (JPEG frames) and 3D/map widgets for robot pose.
- Saved dashboards per group, drag-and-drop layout.
- Auth: token on the bridge, ACL so the supervisor identity can only subscribe.

## Desktop app (Tauri)

Same frontend, wrapped in a native shell. "Start local router" runs a bundled `zenohd` with the
remote-api plugin on a Zenoh config you pick, then connects to its `ws://127.0.0.1:<port>`.
This section is for building it yourself; end users should use the installers above.

```bash
npm run fetch:zenoh     # once per target: downloads zenohd + plugin into src-tauri/ (gitignored)
npm run tauri dev
npm run tauri build     # installers in src-tauri/target/release/bundle/
```

- The sidecar is called `supervisor-zenohd` so it never clashes with a system `zenohd`; if it is
  missing the app falls back to `zenohd` on PATH.
- The bundled plugin directory overrides `plugins_loading/search_dirs` from your config.
- Zenoh version is pinned in `scripts/fetch-zenoh.mjs` (`ZENOH_VERSION`); `zenohd` and the plugin must match.
- CI (`.github/workflows/build.yml`) builds Linux, Windows and macOS (arm64 + x64) installers.
  Pushing a tag like `v0.1.0` attaches them to a draft GitHub release; publish it from the Releases page.
- Run from a non-snap terminal; VS Code's snap env breaks GTK (see GSETTINGS_SCHEMA_DIR).
