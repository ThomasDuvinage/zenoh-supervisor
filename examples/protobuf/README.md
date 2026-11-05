# Protobuf payloads

A publisher sending `demo.RobotState` (see `robot.proto`) and a config that decodes it.

```bash
zenohd -c ../single-router/router.json5     # or "Start local router" in the desktop app
pip install eclipse-zenoh protobuf
protoc --python_out=. robot.proto
python pub_proto.py robot1
```

Import `supervisor.config.json` in the app (upload icon). It already contains the schema and a
subscription on `demo/*/state` decoded as `demo.RobotState`. In the **Live** tab, click a row to see the
decoded message and whether it matches the schema; the **Log** tab shows each message as JSON.

To do it by hand in your own setup: **Subscriptions** → *Add .proto files* (select a schema together with
the files it imports), then choose the message type under *Payload decoder* when adding a subscription.

`stamp_ns` is the send time in epoch nanoseconds, so the subscription uses it as a latency source
(JSON field `stamp_ns`, unit nanoseconds). 64-bit integers are shown as strings to keep full precision.
