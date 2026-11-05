"""Fake device: publishes a few random-walk values and a liveliness token.

    pip install eclipse-zenoh
    python pub.py robot1                                    # router on tcp/127.0.0.1:7447
    python pub.py robot2 --connect tcp/127.0.0.1:7448 --hz 2

Keys:  demo/<name>/temperature, demo/<name>/battery, and the token devices/<name>/alive
Queryables (try them in the Queries tab): demo/<name>/info, demo/<name>/config, demo/<name>/version
"""
import argparse
import json
import random
import time

import zenoh

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("name", help="device name, used in the key expressions")
p.add_argument("--connect", default="tcp/127.0.0.1:7447", help="router locator (default %(default)s)")
p.add_argument("--hz", type=float, default=1.0, help="publish rate (default 1)")
args = p.parse_args()

conf = zenoh.Config()
conf.insert_json5("mode", '"client"')
conf.insert_json5("connect/endpoints", f'["{args.connect}"]')
conf.insert_json5("scouting/multicast/enabled", "false")
session = zenoh.open(conf)

token = session.liveliness().declare_token(f"devices/{args.name}/alive")  # online as long as we run
temp = session.declare_publisher(f"demo/{args.name}/temperature")
battery = session.declare_publisher(f"demo/{args.name}/battery")
started = time.time()
INFO = {
    "info": lambda: {"name": args.name, "uptime_s": round(time.time() - started), "zid": str(session.zid())},
    "config": lambda: {"hz": args.hz, "router": args.connect},
    "version": lambda: {"version": "1.0.0"},
}


def make_handler(kind):
    def handler(query):
        query.reply(query.key_expr, json.dumps(INFO[kind]()))
    return handler


queryables = [session.declare_queryable(f"demo/{args.name}/{k}", make_handler(k)) for k in INFO]
print(f"{args.name}: publishing via {args.connect} at {args.hz} Hz (Ctrl-C to stop)", flush=True)

t, b = 40.0, 100.0
try:
    while True:
        t = min(90.0, max(10.0, t + random.uniform(-2, 2)))  # exceeds 80 now and then -> out-of-range flag
        b = max(0.0, b - random.uniform(0, 0.2))
        temp.put(f"{t:.2f}")
        battery.put(f"{b:.1f}")
        time.sleep(1 / args.hz)
except KeyboardInterrupt:
    pass
finally:
    token.undeclare()
    session.close()
