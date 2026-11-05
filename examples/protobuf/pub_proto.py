"""Fake robot: publishes Protobuf `demo.Envelope` messages (see robot.proto).

    pip install eclipse-zenoh protobuf
    protoc --python_out=. robot.proto
    python pub_proto.py robot1                      # router on tcp/127.0.0.1:7447
    python pub_proto.py robot2 --connect tcp/127.0.0.1:7448 --hz 5

Keys: demo/<name>/state (Envelope holding a State), demo/<name>/command (Envelope holding a Command)
"""
import argparse
import math
import random
import time

import zenoh

import robot_pb2

JOINTS = 6

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("name", help="robot name, used in the key expressions")
p.add_argument("--connect", default="tcp/127.0.0.1:7447", help="router locator (default %(default)s)")
p.add_argument("--hz", type=float, default=2.0, help="publish rate (default 2)")
args = p.parse_args()

conf = zenoh.Config()
conf.insert_json5("mode", '"client"')
conf.insert_json5("connect/endpoints", f'["{args.connect}"]')
conf.insert_json5("scouting/multicast/enabled", "false")
session = zenoh.open(conf)
state_pub = session.declare_publisher(f"demo/{args.name}/state")
command_pub = session.declare_publisher(f"demo/{args.name}/command")
print(f"{args.name}: publishing demo.Envelope on demo/{args.name}/state and /command at {args.hz} Hz (Ctrl-C to stop)", flush=True)

t0 = time.monotonic_ns()
phase = 0.0
try:
    while True:
        phase += 0.1
        q = [math.sin(phase + j) for j in range(JOINTS)]
        dq = [math.cos(phase + j) for j in range(JOINTS)]

        state = robot_pb2.State(
            position=q,
            velocity=dq,
            torque=[random.uniform(-1, 1) for _ in range(JOINTS)],
            body_sensors=[robot_pb2.BodySensor(
                name="imu",
                orientation=[1, 0, 0, 0],
                angular_velocity=[0, 0, 0.1],
                linear_acceleration=[0, 0, 9.81 + random.uniform(-0.05, 0.05)],
            )],
            force_sensors=[robot_pb2.ForceSensor(
                name=side,
                force=[0, 0, 200 + random.uniform(-5, 5)],
                torque=[0, 0, 0],
            ) for side in ("left_foot", "right_foot")],
            stamp=time.monotonic_ns() - t0,
        )
        state_pub.put(robot_pb2.Envelope(topic="state", timestamp=time.time_ns(), state=state).SerializeToString())

        command = robot_pb2.Command(
            kp=100.0, kd=10.0, position=q, velocity=dq, torque=[0.0] * JOINTS,
            state_stamp=state.stamp, state_hold=random.randint(50_000, 200_000),
        )
        command_pub.put(robot_pb2.Envelope(topic="command", timestamp=time.time_ns(), command=command).SerializeToString())
        time.sleep(1 / args.hz)
except KeyboardInterrupt:
    pass
finally:
    session.close()
