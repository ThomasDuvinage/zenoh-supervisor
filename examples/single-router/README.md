# One router, one publisher

```bash
zenohd -c router.json5                 # or "Start local router" in the desktop app
python ../pub.py robot1                # pip install eclipse-zenoh
```

Import `supervisor.config.json` in the app (upload icon). `robot1` shows up with temperature,
battery and a liveliness entry; stop the publisher and it goes offline / stale.

In the **Queries** tab, try `demo/robot1/info`, `demo/robot1/config`, `demo/robot1/version`
(or `demo/robot1/*` for all three); `pub.py` answers them as JSON.
