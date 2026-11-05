"""Fake robot: publishes a Protobuf `demo.RobotState` on demo/<name>/state.

    pip install eclipse-zenoh protobuf
    protoc --python_out=. robot.proto
    python pub_proto.py robot1                      # router on tcp/127.0.0.1:7447
    python pub_proto.py robot2 --connect tcp/127.0.0.1:7448 --hz 5
"""
import argparse
import math
import random
import time

import zenoh

import robot_pb2

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("name", help="robot name, used in the key expression")
p.add_argument("--connect", default="tcp/127.0.0.1:7447", help="router locator (default %(default)s)")
p.add_argument("--hz", type=float, default=2.0, help="publish rate (default 2)")
args = p.parse_args()

conf = zenoh.Config()
conf.insert_json5("mode", '"client"')
conf.insert_json5("connect/endpoints", f'["{args.connect}"]')
conf.insert_json5("scouting/multicast/enabled", "false")
session = zenoh.open(conf)
pub = session.declare_publisher(f"demo/{args.name}/state")
print(f"{args.name}: publishing demo.RobotState on demo/{args.name}/state at {args.hz} Hz (Ctrl-C to stop)", flush=True)

battery, angle = 100.0, 0.0
try:
    while True:
        angle += 0.1
        battery = max(0.0, battery - random.uniform(0, 0.3))
        msg = robot_pb2.RobotState(
            name=args.name,
            mode=robot_pb2.MOVING if battery > 20 else robot_pb2.CHARGING,
            pose=robot_pb2.Pose(x=2 * math.cos(angle), y=2 * math.sin(angle), theta=angle % (2 * math.pi)),
            battery=battery,
            stamp_ns=time.time_ns(),
        )
        pub.put(msg.SerializeToString())
        time.sleep(1 / args.hz)
except KeyboardInterrupt:
    pass
finally:
    session.close()
