# Zenoh Supervisor

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
(one router, one fake robot) or [examples/two-routers](examples/two-routers/README.md).

### What you can see

- **Overview:** every connection with its status, topic count, msg/s, devices alive, and stale
  or out-of-range counts, plus one network graph merging all connections.
- **Live values:** latest value, sparkline, rate and age per topic, with `stale` and
  out-of-range flags.
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
