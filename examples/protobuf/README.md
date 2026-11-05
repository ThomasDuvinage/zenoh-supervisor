# Protobuf payloads

A publisher sending `demo.Envelope` messages (see `robot.proto`: a `oneof` holding a `State` with joint
values and sensors, or a `Command`) and a config that decodes them.

```bash
zenohd -c ../single-router/router.json5     # or "Start local router" in the desktop app
pip install eclipse-zenoh protobuf
protoc --python_out=. robot.proto
python pub_proto.py robot1
```

Import `supervisor.config.json` in the desktop app (upload icon). It points to `robot.proto` next to it and has
subscriptions on `demo/*/state` and `demo/*/command`, both decoded as `demo.Envelope`. In the **Live** tab, click a row to see the
decoded message and whether it matches the schema; the **Log** tab shows each message as JSON.

To do it by hand in your own setup: **Subscriptions** → *Add .proto files* (select a schema together with
the files it imports), then choose the message type under *Payload decoder* when adding a subscription.

`Envelope.timestamp` is the send time in epoch nanoseconds, so the subscriptions use it as a latency source
(JSON field `timestamp`, unit nanoseconds). 64-bit integers are shown as strings to keep full precision.

A schema in a config is either inline (`{ "name": "robot.proto", "source": "syntax = ..." }`) or a path relative to
the config file (`{ "path": "robot.proto" }`), which is read when the config is imported. A config uploaded in the
browser has no location to resolve a path against; there, inline the source or use *Add .proto files*.
The `public/supervisor.config.json` loaded at startup of the web app can reference files in `public/` the same way.
