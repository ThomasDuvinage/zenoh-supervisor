# Zenoh Supervisor

[![Release](https://img.shields.io/github/v/release/ThomasDuvinage/zenoh-supervisor?include_prereleases)](https://github.com/ThomasDuvinage/zenoh-supervisor/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/ThomasDuvinage/zenoh-supervisor/build.yml?label=build)](https://github.com/ThomasDuvinage/zenoh-supervisor/actions/workflows/build.yml)
[![License](https://img.shields.io/badge/license-BSD%202--Clause-blue)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20Windows%20%7C%20macOS-blue)
[![Zenoh](https://img.shields.io/badge/Zenoh-1.10.1-orange)](https://zenoh.io)
[![Website](https://img.shields.io/badge/web-GitHub%20Pages-brightgreen)](https://thomasduvinage.github.io/zenoh-supervisor/)

Read-only dashboard to watch one or more devices (robots, servers, anything that
speaks Zenoh): live values, who is online, queries, network topology and latency.

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

Use the hosted site: https://thomasduvinage.github.io/zenoh-supervisor/

It is served over HTTPS, so browsers only allow bridges at `ws://localhost` or `wss://...`.
For plain `ws://` bridges on your network, use the desktop app or serve the site yourself
(see below).

### From source

Requirements: Node.js 20+ and, for the desktop app, a stable [Rust toolchain](https://rustup.rs).
On Linux, install the Tauri system libraries first:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev libssl-dev
```

Windows and macOS need the usual [Tauri prerequisites](https://tauri.app/start/prerequisites/)
(MSVC build tools and WebView2, or Xcode command line tools).

```bash
git clone https://github.com/ThomasDuvinage/zenoh-supervisor.git
cd zenoh-supervisor
npm ci

# Desktop app
npm run fetch:zenoh      # downloads zenohd + remote-api plugin for your machine
npm run tauri dev        # run with hot reload
npm run tauri build      # installers in src-tauri/target/release/bundle/

# Web version only
npm run dev              # http://localhost:5173
npm run build            # static files in dist/, serve with any web server
```

On Linux, run from a regular terminal: the environment of a snap-installed VS Code breaks GTK.

## Usage

The browser cannot open raw Zenoh TCP (port 7447), so the supervisor talks to a router that
runs the **zenoh-plugin-remote-api** bridge (a WebSocket, `ws://host:10000` by default).
The stock `eclipse/zenoh` image does not include it.

1. **Get a router with the bridge.** Either:
   - desktop app: click **Start local router** in the sidebar and pick a Zenoh config
     (try `examples/single-router/router.json5`). The app starts the bundled `zenohd`
     and adds the connection for you; or
   - run your own: `zenohd -c router.json5` with `plugins: { remote_api: { websocket_port: "10000" } }`.
2. **Add a device.** Click **Add device**, enter a name and the bridge URL (`ws://host:10000`).
   Connections can be grouped and set to connect on start. They are read-only by default.
3. **Subscribe.** Open the device and add key expressions, for example `robot1/sensors/**`
   (data) or `devices/*/alive` (liveliness). Optionally set a unit, min/max and a stale timeout
   to get out-of-range and stale flags.
4. **Watch.** See the tabs below.
5. **Save your setup.** Import, export or reset the config with the sidebar buttons (see Config).

Try it without hardware: [examples/single-router](examples/single-router/README.md)
(one router, one fake robot), [examples/two-routers](examples/two-routers/README.md), or
[examples/protobuf](examples/protobuf/README.md) (a robot publishing Protobuf messages).

### What you can see

- **Overview:** every connection with its status, topic count, msg/s, devices alive, and stale
  or out-of-range counts, plus one network graph merging all connections.
- **Live values:** latest value, sparkline, rate and age per topic, with `stale` and
  out-of-range flags. Protobuf topics expand on click to the decoded message (see Protobuf).
- **Liveliness:** which devices are online, with no heartbeat messages needed.
- **Log:** filter, pause, clear and export as JSON.
- **Queries:** run a `get` on any selector (device info, config, version) and see every reply
  with its timing and errors.
- **Topology:** the routers and peers the bridge is linked to (zid, role, locators). A bridge
  only sees its direct neighbours; connect to more routers to see more.
- **Publish:** only available once you turn read-only off for a connection.

Connections reconnect automatically with backoff, and can be added or removed at any time.

## Config

On first start the supervisor loads `supervisor.config.json` (the default is in `public/`), then
keeps your changes in the browser's local storage. Edit from the UI, or use the sidebar
buttons to import, export or reset to the file.

```jsonc
{
  "version": 1,
  "schemas": [{ "path": "robot.proto" }],  // optional, see Protobuf
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

## Protobuf

Payloads sent as Protobuf can be decoded into readable values. Everything runs in the app; nothing
is sent anywhere.

1. **Load the schema.** In a device's **Subscriptions** tab, click **Add .proto files** and select
   the schema together with every file it imports. Files are parsed as one set, so the order does not
   matter, and a missing import is reported.
2. **Pick the type.** When adding a subscription, choose the message under **Payload decoder**
   (for example `demo.Envelope`). A subscription decodes everything it receives as that one type.
3. **Read it.** The Live table shows the decoded message. Click a row to see it expanded, with
   a check that it matches the schema. The Log tab shows each message as JSON, and the filter searches it.

Decoded messages are plain JSON, so the other features work on them: a latency source can be a
JSON field (`header.stamp`, with the field names exactly as written in the `.proto`).
64-bit integers and bytes are shown as strings to keep full precision, and enums by name.

A payload that does not decode with the chosen type is counted as a decode error on its row.
A payload can also decode without error while being the wrong type, so the expanded row checks that every
field on the wire exists in the schema with a fitting type: `matches schema` is a good sign, while
a warning about unknown or mistyped fields means the type is probably wrong.

In a config file, a schema is either inline (`{ "name": "robot.proto", "source": "syntax = ..." }`) or a
path relative to the config (`{ "path": "robot.proto" }`), read when the config is imported. The path form
works in the desktop app and for the default `public/supervisor.config.json`; a config uploaded in the
browser has no location to resolve it against, so inline the source or add the files in the UI.
A subscription selects its type with `"decoder": { "kind": "protobuf", "messageType": "demo.Envelope" }`.
See [examples/protobuf](examples/protobuf/README.md).

## Latency

Each subscription can measure latency without publishing or querying anything, so it adds no
traffic. Pick a source: the Zenoh message timestamp, an attachment holding an epoch number, or
a field of a JSON payload (epoch number or ISO date).

Latency is the browser's receive time minus the send time, so it includes the bridge and
WebSocket hop. Treat it as a proxy for the delay your real consumer sees.

- Epoch numbers are UTC. ISO strings without a timezone are read as UTC by default
  (you can switch to browser-local).
- It is a one-way delay, so clocks that are out of sync shift it by a constant. Use **Relative**
  mode (delay above the lowest seen), or set a clock offset per subscription: type it, or click
  **Align** to set it from the lowest delay seen.
