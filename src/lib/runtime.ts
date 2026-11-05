import { Config, Duration, Reply, ReplyError, Session, Subscriber, Sample, SampleKind, WhatAmI } from "@eclipse-zenoh/zenoh-ts";
import type { DeviceConfig, LatencyConfig, Status, SubscriptionConfig, TimeUnit } from "./types";

const HISTORY = 60;
const LOG_MAX = 500;
const RATE_WINDOW_MS = 5000;
export const LAT_WINDOW = 500;
const TOPO_POLL_MS = 3000;

const UNIT_MS: Record<TimeUnit, number> = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 };

const HAS_TZ = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/** ISO string -> epoch ms. A string without timezone is read as UTC unless told otherwise
 *  (Date.parse alone would silently use the browser's timezone). */
function parseIso(v: string, naive: "utc" | "local"): number | undefined {
  let t = v.trim().replace(" ", "T");
  if (naive === "utc" && t.includes("T") && !HAS_TZ.test(t)) t += "Z";
  const d = Date.parse(t);
  return Number.isNaN(d) ? undefined : d;
}

/** send time in epoch ms, or undefined when the message carries none */
function sentTimeMs(lat: LatencyConfig, sample: Sample, value: unknown): number | undefined {
  if (lat.source === "zenoh") return sample.timestamp()?.getMsSinceUnixEpoch();
  const factor = UNIT_MS[lat.unit ?? "ms"];
  let v: unknown;
  if (lat.source === "attachment") {
    v = Number(sample.attachment()?.toString());
  } else {
    v = value;
    for (const part of (lat.field ?? "").split(".").filter(Boolean)) {
      v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[part] : undefined;
    }
    if (typeof v === "string") return parseIso(v, lat.naive ?? "utc");
  }
  return typeof v === "number" && Number.isFinite(v) ? v * factor : undefined;
}

export interface KeyState {
  key: string;
  subId: string;
  raw: string;
  value: unknown;
  count: number;
  lastTs: number;
  /** numeric samples, newest last, for the sparkline */
  history: number[];
  /** arrival times inside the rate window */
  times: number[];
  /** latency samples in ms (newest last, last LAT_WINDOW), when a latency source is configured */
  lat: number[];
  latCount: number;
  /** lowest latency seen since the last reset (offset included), for relative mode */
  latMin: number;
  /** samples with no usable send time (e.g. zenoh timestamping disabled) */
  latMissing: number;
}

/** "unknown" is the bridge itself: the API does not expose its own mode */
export type NodeRole = "router" | "peer" | "client" | "unknown";

export interface TopoNode {
  zid: string;
  role: NodeRole;
  /** the bridge's own session */
  self: boolean;
}

export interface TopoLink {
  /** locators as seen by the bridge */
  src: string;
  dst: string;
  mtu: number;
  streamed: boolean;
}

export interface TopoEdge {
  a: string;
  b: string;
  multicast: boolean;
  links: TopoLink[];
}

/** what one bridge session sees: itself plus its direct neighbours */
export interface Topology {
  nodes: TopoNode[];
  edges: TopoEdge[];
  updatedAt: number;
}

/** Union of several bridges' views, joined on zid. A node seen with a known role wins over "unknown". */
export function mergeTopologies(views: { name: string; topology: Topology }[]): { nodes: (TopoNode & { names: string[] })[]; edges: TopoEdge[] } {
  const nodes = new Map<string, TopoNode & { names: string[] }>();
  const edges = new Map<string, TopoEdge>();
  for (const { name, topology } of views) {
    for (const n of topology.nodes) {
      const cur = nodes.get(n.zid);
      if (!cur) nodes.set(n.zid, { ...n, names: n.self ? [name] : [] });
      else {
        if (cur.role === "unknown") cur.role = n.role;
        if (n.self) { cur.self = true; cur.names.push(name); }
      }
    }
    for (const e of topology.edges) {
      const key = [e.a, e.b].sort().join("|");
      const cur = edges.get(key);
      if (!cur) edges.set(key, { ...e, links: [...e.links] });
      else {
        // both ends report the same link with src/dst swapped
        const seen = new Set(cur.links.map((l) => [l.src, l.dst].sort().join("|")));
        for (const l of e.links) if (!seen.has([l.src, l.dst].sort().join("|"))) cur.links.push(l);
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const ROLE: Record<number, NodeRole> = { [WhatAmI.ROUTER]: "router", [WhatAmI.PEER]: "peer", [WhatAmI.CLIENT]: "client" };

export interface QueryReply {
  /** key the queryable answered on (empty for an error reply) */
  key: string;
  raw: string;
  error: boolean;
}

export interface QueryResult {
  selector: string;
  startedAt: number;
  durationMs: number;
  replies: QueryReply[];
  /** set when the query itself failed (not connected, bad selector, ...) */
  failure?: string;
}

export interface LogEntry {
  ts: number;
  key: string;
  kind: "PUT" | "DELETE";
  raw: string;
}

function toQueryReply(reply: Reply): QueryReply {
  const r = reply.result();
  if (r instanceof ReplyError) return { key: "", raw: r.payload().toString(), error: true };
  return { key: r.keyexpr().toString(), raw: r.payload().toString(), error: false };
}

function parsePayload(raw: string): unknown {
  const t = raw.trim();
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      /* not JSON, keep text */
    }
  }
  return raw;
}

/**
 * One zenoh session to one device (bridge). Holds all live data outside React;
 * the UI polls it through the store tick, so high-rate topics don't re-render per message.
 */
export class DeviceRuntime {
  status: Status = "disconnected";
  error?: string;
  keys = new Map<string, KeyState>();
  /** liveliness: key -> time first seen */
  alive = new Map<string, number>();
  log: LogEntry[] = [];
  subErrors = new Map<string, string>();
  topology?: Topology;
  topologyError?: string;
  totalMessages = 0;
  paused = false;
  dirty = true;

  private session: Session | null = null;
  private subs = new Map<string, Subscriber>();
  private liveSubs = new Map<string, SubscriptionConfig>();
  private wanted = false;
  private attempt = 0;
  private retryTimer?: number;
  private watchdog?: number;
  private topoListeners: { undeclare(): Promise<void> }[] = [];
  private topoTimer?: number;
  private topoPoll?: number;

  constructor(
    public cfg: DeviceConfig,
    private onStatus: (id: string, status: Status) => void,
  ) {}

  async connect(): Promise<void> {
    this.wanted = true;
    await this.open();
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    await this.teardown();
    this.error = undefined;
    this.setStatus("disconnected");
  }

  async addSubscription(sub: SubscriptionConfig): Promise<void> {
    if (this.session) await this.declare(sub);
  }

  async removeSubscription(id: string): Promise<void> {
    const s = this.subs.get(id);
    this.subs.delete(id);
    this.subErrors.delete(id);
    try {
      await s?.undeclare();
    } catch {
      /* session may already be gone */
    }
    for (const [k, v] of this.keys) if (v.subId === id) this.keys.delete(k);
    this.dirty = true;
  }

  async put(keyexpr: string, text: string): Promise<void> {
    if (this.cfg.readOnly) throw new Error("device is read-only");
    if (!this.session) throw new Error("not connected");
    await this.session.put(keyexpr, text);
  }

  /** One-shot `get`: collects every reply until the queryables are done or the timeout hits.
   *  A payload can change state on the device, so it is refused on read-only devices. */
  async query(selector: string, timeoutMs: number, payload?: string): Promise<QueryResult> {
    const startedAt = Date.now();
    const t0 = performance.now();
    const done = (replies: QueryReply[], failure?: string): QueryResult =>
      ({ selector, startedAt, durationMs: performance.now() - t0, replies, failure });
    if (!this.session) return done([], "not connected");
    if (payload && this.cfg.readOnly) return done([], "device is read-only: query payloads are disabled");
    const replies: QueryReply[] = [];
    try {
      const rx = await this.session.get(selector, {
        timeout: Duration.milliseconds.of(timeoutMs),
        payload: payload || undefined,
      });
      if (!rx) return done([], "no reply channel");
      for await (const reply of rx) replies.push(toQueryReply(reply));
    } catch (e) {
      return done(replies, e instanceof Error ? e.message : String(e));
    }
    return done(replies);
  }

  /** handlers capture the sub config at declare time; swap in the edited one */
  updateSubscriptionConfig(sub: SubscriptionConfig): void {
    this.liveSubs.set(sub.id, sub);
  }

  resetLatency(subId?: string): void {
    for (const k of this.keys.values()) {
      if (subId && k.subId !== subId) continue;
      k.lat = [];
      k.latCount = 0;
      k.latMin = Infinity;
      k.latMissing = 0;
    }
    this.dirty = true;
  }

  clearData(): void {
    this.keys.clear();
    this.log = [];
    this.totalMessages = 0;
    this.dirty = true;
  }

  rate(k: KeyState, now: number): number {
    return k.times.filter((t) => now - t <= RATE_WINDOW_MS).length / (RATE_WINDOW_MS / 1000);
  }

  private setStatus(s: Status) {
    this.status = s;
    this.dirty = true;
    this.onStatus(this.cfg.id, s);
  }

  private async open(): Promise<void> {
    if (this.session || this.status === "connecting") return;
    this.setStatus("connecting");
    try {
      const session = await Session.open(new Config(this.cfg.url));
      if (!this.wanted) {
        await session.close();
        return;
      }
      this.session = session;
      this.attempt = 0;
      this.error = undefined;
      for (const s of this.cfg.subscriptions) await this.declare(s);
      this.setStatus("connected");
      void this.watchTopology();
      this.watchdog = window.setInterval(() => {
        if (this.session?.isClosed()) void this.lost("connection lost");
      }, 2000);
    } catch (e) {
      await this.lost(e instanceof Error ? e.message : String(e));
    }
  }

  private async lost(reason: string): Promise<void> {
    await this.teardown();
    this.error = reason;
    this.setStatus("error");
    if (this.wanted) {
      const delay = Math.min(30000, 1000 * 2 ** this.attempt++);
      this.retryTimer = window.setTimeout(() => void this.open(), delay);
    }
  }

  private async teardown(): Promise<void> {
    window.clearInterval(this.watchdog);
    const session = this.session;
    this.session = null;
    this.subs.clear();
    this.alive.clear();
    window.clearTimeout(this.topoTimer);
    window.clearInterval(this.topoPoll);
    for (const l of this.topoListeners.splice(0)) l.undeclare().catch(() => undefined);
    this.topology = undefined;
    this.topologyError = undefined;
    try {
      await session?.close();
    } catch {
      /* already closed */
    }
    this.dirty = true;
  }

  /** Reads the bridge's neighbours once, then again (debounced) on every transport/link event.
   *  Older bridges may lack the connectivity API; the error is kept for the UI instead of failing the connection. */
  private async watchTopology(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      const info = await session.info();
      const onEvent = () => {
        window.clearTimeout(this.topoTimer);
        this.topoTimer = window.setTimeout(() => void this.refreshTopology(), 300);
      };
      this.topoListeners.push(
        await info.transportEventsListener({ handler: onEvent }),
        await info.linkEventsListener({ handler: onEvent }),
      );
      await this.refreshTopology();
      // events can be missed (links that come up right after connecting, some webviews), so also re-read slowly
      this.topoPoll = window.setInterval(() => void this.refreshTopology(), TOPO_POLL_MS);
    } catch (e) {
      this.topologyError = e instanceof Error ? e.message : String(e);
      this.dirty = true;
    }
  }

  private async refreshTopology(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      const info = await session.info();
      const self = info.zid().toString();
      const [transports, links] = await Promise.all([info.transports(), info.links()]);
      const nodes: TopoNode[] = [{ zid: self, role: "unknown", self: true }];
      const edges: TopoEdge[] = [];
      for (const t of transports) {
        const zid = t.zid().toString();
        if (zid === self) continue;
        nodes.push({ zid, role: ROLE[t.whatami()] ?? "peer", self: false });
        edges.push({
          a: self,
          b: zid,
          multicast: t.isMulticast(),
          links: links
            .filter((l) => l.zid().toString() === zid)
            .map((l) => ({ src: l.src(), dst: l.dst(), mtu: l.mtu(), streamed: l.isStreamed() })),
        });
      }
      const changed = JSON.stringify([nodes, edges]) !== JSON.stringify([this.topology?.nodes, this.topology?.edges]);
      if (changed || this.topologyError) this.topology = { nodes, edges, updatedAt: Date.now() };
      this.topologyError = undefined;
      if (changed) this.dirty = true;
    } catch (e) {
      this.topologyError = e instanceof Error ? e.message : String(e);
      this.dirty = true;
    }
  }

  private async declare(sub: SubscriptionConfig): Promise<void> {
    if (!this.session) return;
    this.liveSubs.set(sub.id, sub);
    const handler = (sample: Sample) => this.onSample(this.liveSubs.get(sub.id) ?? sub, sample);
    try {
      const subscriber =
        sub.kind === "liveliness"
          ? await this.session.liveliness().declareSubscriber(sub.keyexpr, { handler, history: true })
          : await this.session.declareSubscriber(sub.keyexpr, { handler });
      this.subs.set(sub.id, subscriber);
      this.subErrors.delete(sub.id);
    } catch (e) {
      this.subErrors.set(sub.id, e instanceof Error ? e.message : String(e));
    }
    this.dirty = true;
  }

  private onSample(sub: SubscriptionConfig, sample: Sample): void {
    if (this.paused) return;
    const key = sample.keyexpr().toString();
    const kind = sample.kind() === SampleKind.DELETE ? "DELETE" : "PUT";
    const now = Date.now();

    if (sub.kind === "liveliness") {
      if (kind === "PUT") this.alive.set(key, now);
      else this.alive.delete(key);
      this.dirty = true;
      return;
    }

    // arrival time taken first, with sub-ms resolution
    const arrival = performance.timeOrigin + performance.now();
    const raw = sample.payload().toString();
    this.totalMessages++;
    let k = this.keys.get(key);
    if (!k) {
      k = { key, subId: sub.id, raw, value: raw, count: 0, lastTs: now, history: [], times: [], lat: [], latCount: 0, latMin: Infinity, latMissing: 0 };
      this.keys.set(key, k);
    }
    k.raw = raw;
    k.value = parsePayload(raw);
    k.count++;
    k.lastTs = now;
    k.times.push(now);
    if (k.times.length > 200) k.times.splice(0, k.times.length - 200);
    if (typeof k.value === "number") {
      k.history.push(k.value);
      if (k.history.length > HISTORY) k.history.shift();
    }

    if (sub.latency) {
      const sent = sentTimeMs(sub.latency, sample, k.value);
      if (sent === undefined) {
        k.latMissing++;
      } else {
        const l = arrival - sent - (sub.latency.offsetMs ?? 0);
        k.lat.push(l);
        if (l < k.latMin) k.latMin = l;
        k.latCount++;
        if (k.lat.length > LAT_WINDOW) k.lat.shift();
      }
    }

    this.log.push({ ts: now, key, kind, raw });
    if (this.log.length > LOG_MAX * 1.2) this.log.splice(0, this.log.length - LOG_MAX);
    this.dirty = true;
  }
}
