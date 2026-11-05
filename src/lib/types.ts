import type { ProtoFile } from "./proto";

export type SubKind = "data" | "liveliness";
export type Status = "disconnected" | "connecting" | "connected" | "error";

export type TimeUnit = "s" | "ms" | "us" | "ns";

/**
 * Where the send time of a message comes from. Purely passive: the supervisor
 * only reads data already present in the messages it receives.
 */
export interface LatencyConfig {
  /** zenoh: the message's own timestamp (needs timestamping enabled on the publisher/router)
   *  attachment: attachment text holding an epoch number
   *  json: a field of a JSON payload holding an epoch number or ISO date */
  source: "zenoh" | "attachment" | "json";
  /** json only: dotted path, e.g. "header.stamp" */
  field?: string;
  /** unit of the epoch number (attachment/json); default ms */
  unit?: TimeUnit;
  /** added to the sender clock before computing latency, to correct a known clock offset (ms) */
  offsetMs?: number;
  /** json only: how to read ISO strings that carry no timezone ("2026-10-24T14:00:00"). Default utc. */
  naive?: "utc" | "local";
}

/** How a payload is turned into a value. Absent = plain text / number / JSON, guessed. */
export interface DecoderConfig {
  kind: "protobuf";
  /** fully qualified message name from the loaded schemas, e.g. "robot.Pose" */
  messageType: string;
}

export interface SubscriptionConfig {
  id: string;
  keyexpr: string;
  label?: string;
  /** "data" = normal pub/sub, "liveliness" = who is alive (tokens) */
  kind: SubKind;
  unit?: string;
  /** flag a key as stale when nothing arrived for this long */
  staleAfterSec?: number;
  /** numeric alert thresholds */
  min?: number;
  max?: number;
  latency?: LatencyConfig;
  decoder?: DecoderConfig;
}

export interface DeviceConfig {
  id: string;
  name: string;
  /** WebSocket locator of a zenoh-plugin-remote-api, e.g. ws://host:10000 */
  url: string;
  group?: string;
  autoConnect: boolean;
  /** when true the UI never publishes to this device */
  readOnly: boolean;
  /** absolute: raw delay (needs synchronised clocks). relative: delay above the lowest seen, immune to a constant clock offset */
  latencyMode?: "absolute" | "relative";
  subscriptions: SubscriptionConfig[];
}

export interface AppConfig {
  version: 1;
  devices: DeviceConfig[];
  /** .proto files available to the Protobuf decoders */
  schemas?: ProtoFile[];
}
