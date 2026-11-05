import { Fragment, useRef, useState } from "react";
import { Plug, Unplug, Trash2, Pause, Play, Eraser, FileCode2 } from "lucide-react";
import { useStore, getRuntime } from "../lib/store";
import type { DeviceConfig, LatencyConfig, TimeUnit } from "../lib/types";
import { isCanonical, listMessageTypes } from "../lib/proto";
import type { QueryResult } from "../lib/runtime";
import { fmtMs, latencyStats } from "../lib/latency";
import { TopologyGraph, shortZid } from "./TopologyGraph";
import { Badge, Field, Sparkline, StatusDot, fmtAge, fmtValue } from "./ui";

type Tab = "live" | "latency" | "log" | "queries" | "topology" | "subs" | "connection" | "publish";

export function DeviceView({ device }: { device: DeviceConfig }) {
  const { statuses, connect, disconnect, removeDevice, tick } = useStore();
  void tick;
  const rt = getRuntime(device.id);
  const status = statuses[device.id] ?? "disconnected";
  const [tab, setTab] = useState<Tab>("live");
  const tabs: [Tab, string][] = [["live", "Live"], ["latency", "Latency"], ["log", "Log"], ["queries", "Queries"], ["topology", "Topology"], ["subs", "Subscriptions"], ["connection", "Connection"]];
  if (!device.readOnly) tabs.push(["publish", "Publish"]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
        <StatusDot status={status} />
        <div>
          <h1 className="text-lg font-semibold">{device.name}</h1>
          <div className="text-xs text-zinc-500">{device.url}{rt?.error && <span className="ml-2 text-red-400">{rt.error}</span>}</div>
        </div>
        <div className="ml-auto flex gap-2">
          {status === "disconnected" || status === "error"
            ? <button className="btn btn-primary" onClick={() => void connect(device.id)}><Plug size={14} /> Connect</button>
            : <button className="btn" onClick={() => void disconnect(device.id)}><Unplug size={14} /> Disconnect</button>}
          <button className="btn" onClick={() => confirm(`Remove ${device.name}?`) && void removeDevice(device.id)}><Trash2 size={14} /></button>
        </div>
      </header>
      <nav className="flex gap-1 border-b border-zinc-800 px-6">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-2 text-sm ${tab === id ? "border-b-2 border-sky-500 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>{label}</button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "live" && <Live device={device} />}
        {tab === "latency" && <Latency device={device} />}
        {tab === "log" && <Log device={device} />}
        {tab === "queries" && <Queries device={device} />}
        {tab === "topology" && <Topology device={device} />}
        {tab === "subs" && <Subs device={device} />}
        {tab === "connection" && <Connection device={device} />}
        {tab === "publish" && <Publish device={device} />}
      </div>
    </div>
  );
}

function Live({ device }: { device: DeviceConfig }) {
  const rt = getRuntime(device.id);
  const now = Date.now();
  const keys = [...(rt?.keys.values() ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  const alive = [...(rt?.alive.keys() ?? [])].sort();
  const subOf = (id: string) => device.subscriptions.find((s) => s.id === id);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {device.subscriptions.some((s) => s.kind === "liveliness") && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-400">Online ({alive.length})</h2>
          <div className="flex flex-wrap gap-2">
            {alive.length === 0 && <span className="text-sm text-zinc-600">nobody</span>}
            {alive.map((k) => <Badge key={k} tone="emerald">{k}</Badge>)}
          </div>
        </section>
      )}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-400">Topics ({keys.length})</h2>
          <button className="btn ml-auto" onClick={() => { if (rt) { rt.paused = !rt.paused; rt.dirty = true; } }}>
            {rt?.paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
          </button>
          <button className="btn" onClick={() => rt?.clearData()}><Eraser size={14} /> Clear</button>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs text-zinc-500">
              <tr><th className="px-3 py-2">Key</th><th>Value</th><th>Trend</th><th>Rate</th><th>Last</th><th>State</th></tr>
            </thead>
            <tbody>
              {keys.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-600">No data yet</td></tr>}
              {keys.map((k) => {
                const sub = subOf(k.subId);
                const age = now - k.lastTs;
                const stale = !!sub?.staleAfterSec && age > sub.staleAfterSec * 1000;
                const oor = typeof k.value === "number" && ((sub?.min !== undefined && k.value < sub.min) || (sub?.max !== undefined && k.value > sub.max));
                const decoder = sub?.decoder;
                const expanded = open === k.key && decoder && k.bytes;
                return (
                  <Fragment key={k.key}>
                    <tr className={`border-t border-zinc-800 ${decoder ? "cursor-pointer hover:bg-zinc-900" : ""}`} onClick={() => decoder && setOpen(open === k.key ? null : k.key)}>
                      <td className="px-3 py-2 font-mono text-xs">{k.key}</td>
                      <td className={`max-w-xs truncate font-mono ${oor ? "text-red-400" : ""}`}>{fmtValue(k.value)}{sub?.unit && typeof k.value === "number" ? ` ${sub.unit}` : ""}</td>
                      <td><Sparkline data={k.history} alert={oor} /></td>
                      <td className="tabular-nums text-zinc-400">{rt!.rate(k, now).toFixed(1)} Hz</td>
                      <td className="text-zinc-400">{fmtAge(age)}</td>
                      <td>
                        {k.decodeErrors > 0 ? <Badge tone="red">{k.decodeErrors} decode errors</Badge>
                          : stale ? <Badge tone="amber">stale</Badge> : oor ? <Badge tone="red">range</Badge> : <Badge tone="emerald">ok</Badge>}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-zinc-950">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                            <span className="font-mono">{decoder.messageType}</span>
                            <span>{k.bytes!.length} bytes</span>
                            {k.decodeError
                              ? <Badge tone="red">{k.decodeError}</Badge>
                              : isCanonical(decoder.messageType, k.bytes!)
                                ? <Badge tone="emerald">matches schema</Badge>
                                : <Badge tone="amber">decoded, but re-encoding differs: the type may be wrong</Badge>}
                          </div>
                          {!k.decodeError && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-zinc-300">{JSON.stringify(k.value, null, 2)}</pre>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Log({ device }: { device: DeviceConfig }) {
  const rt = getRuntime(device.id);
  const [filter, setFilter] = useState("");
  const rows = (rt?.log ?? []).filter((l) => !filter || l.key.includes(filter) || l.raw.includes(filter)).slice(-200).reverse();

  const download = () => {
    const blob = new Blob([JSON.stringify(rt?.log ?? [], null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${device.name}-log.json`;
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input max-w-xs" placeholder="Filter key or payload" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn" onClick={download}>Export JSON</button>
      </div>
      <div className="card overflow-hidden font-mono text-xs">
        {rows.map((l, i) => (
          <div key={i} className="flex gap-3 border-b border-zinc-800 px-3 py-1.5 last:border-0">
            <span className="text-zinc-500">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="text-sky-400">{l.key}</span>
            <span className="truncate text-zinc-300">{l.raw}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="px-3 py-6 text-center text-zinc-600">No messages</div>}
      </div>
    </div>
  );
}

function prettyPayload(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* plain text */ }
  }
  return raw;
}

function Queries({ device }: { device: DeviceConfig }) {
  const rt = getRuntime(device.id);
  const [selector, setSelector] = useState("");
  const [timeout, setTimeoutMs] = useState("3000");
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<QueryResult[]>([]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rt) return;
    setBusy(true);
    const res = await rt.query(selector, Number(timeout) || 3000, payload || undefined);
    setHistory((h) => [res, ...h].slice(0, 20));
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="card space-y-3 p-4">
        <p className="text-xs text-zinc-400">
          Sends a Zenoh <code>get</code> and shows every reply. Use it for device info, config or version queryables.
          Parameters go after <code>?</code>, e.g. <code>robot1/config?section=net</code>.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="Selector"><input className="input" required value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="robot1/info" /></Field></div>
          <Field label="Timeout (ms)"><input className="input" type="number" min={100} value={timeout} onChange={(e) => setTimeoutMs(e.target.value)} /></Field>
        </div>
        {!device.readOnly && (
          <Field label="Payload (optional, text)"><textarea className="input" rows={2} value={payload} onChange={(e) => setPayload(e.target.value)} /></Field>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Waiting…" : "Get"}</button>
          {history.length > 0 && <button type="button" className="btn ml-auto" onClick={() => setHistory([])}><Eraser size={14} /> Clear</button>}
        </div>
      </form>
      {history.length === 0 && <p className="text-sm text-zinc-600">No query yet.</p>}
      {history.map((r, i) => (
        <div key={r.startedAt + ":" + i} className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
            <span className="font-mono text-sky-400">{r.selector}</span>
            <span className="text-zinc-500">{new Date(r.startedAt).toLocaleTimeString()}</span>
            <span className="text-zinc-500">{r.durationMs.toFixed(0)} ms</span>
            <Badge tone={r.replies.length ? "emerald" : "amber"}>{r.replies.length} repl{r.replies.length === 1 ? "y" : "ies"}</Badge>
            {r.failure && <Badge tone="red">{r.failure}</Badge>}
          </div>
          {r.replies.length === 0 && !r.failure && <div className="px-3 py-4 text-sm text-zinc-600">No queryable answered before the timeout.</div>}
          {r.replies.map((p, j) => (
            <div key={j} className="border-b border-zinc-800 px-3 py-2 last:border-0">
              <div className="mb-1 flex items-center gap-2 text-xs">
                {p.error ? <Badge tone="red">error reply</Badge> : <span className="font-mono text-sky-400">{p.key}</span>}
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-zinc-300">{prettyPayload(p.raw)}</pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Topology({ device }: { device: DeviceConfig }) {
  const rt = getRuntime(device.id);
  const topo = rt?.topology;
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        What this bridge sees: its own session and the routers and peers it is directly linked to. Routers further away appear
        when you also connect to them (see the overview). Read-only, nothing is published.
      </p>
      {rt?.topologyError && <p className="text-sm text-amber-400">Topology unavailable: {rt.topologyError}</p>}
      {!topo && !rt?.topologyError && <p className="text-sm text-zinc-600">{rt?.status === "connected" ? "Reading session info…" : "Connect to see the topology."}</p>}
      {topo && (
        <>
          <div className="card p-3"><TopologyGraph nodes={topo.nodes} edges={topo.edges} /></div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-left text-xs text-zinc-500"><tr><th className="px-3 py-2">Zenoh id</th><th>Role</th><th>Links</th></tr></thead>
              <tbody>
                {topo.nodes.map((n) => (
                  <tr key={n.zid} className="border-t border-zinc-800">
                    <td className="px-3 py-2 font-mono text-xs" title={n.zid}>{shortZid(n.zid)}…{n.zid.slice(-4)}{n.self && <span className="ml-2"><Badge tone="emerald">bridge</Badge></span>}</td>
                    <td className="text-zinc-400">{n.role === "unknown" ? "–" : n.role}</td>
                    <td className="font-mono text-xs text-zinc-400">{topo.edges.find((e) => e.b === n.zid)?.links.map((l) => l.dst).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Subs({ device }: { device: DeviceConfig }) {
  const { addSubscription, removeSubscription } = useStore();
  const rt = getRuntime(device.id);
  const [msgType, setMsgType] = useState("");
  const [keyexpr, setKeyexpr] = useState("");
  const [kind, setKind] = useState<"data" | "liveliness">("data");
  const [label, setLabel] = useState("");
  const [stale, setStale] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [unit, setUnit] = useState("");
  const [latSource, setLatSource] = useState<"" | LatencyConfig["source"]>("");
  const [latField, setLatField] = useState("");
  const [latUnit, setLatUnit] = useState<TimeUnit>("ms");
  const [latNaive, setLatNaive] = useState<"utc" | "local">("utc");
  const num = (s: string) => (s === "" ? undefined : Number(s));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    await addSubscription(device.id, {
      keyexpr, kind, label: label || undefined, unit: unit || undefined,
      staleAfterSec: num(stale), min: num(min), max: num(max),
      latency: latSource ? { source: latSource, field: latField || undefined, unit: latUnit, naive: latNaive } : undefined,
      decoder: msgType && kind === "data" ? { kind: "protobuf", messageType: msgType } : undefined,
    });
    setLatSource(""); setLatField(""); setMsgType("");
    setKeyexpr(""); setLabel(""); setStale(""); setMin(""); setMax(""); setUnit("");
  };

  const types = listMessageTypes();

  return (
    <div className="space-y-6">
      <Schemas />
      <div className="card divide-y divide-zinc-800">
        {device.subscriptions.length === 0 && <div className="px-4 py-6 text-center text-zinc-600">No subscriptions</div>}
        {device.subscriptions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <Badge tone={s.kind === "liveliness" ? "emerald" : "zinc"}>{s.kind}</Badge>
            <span className="font-mono">{s.keyexpr}</span>
            <span className="text-zinc-500">{s.label}</span>
            {s.staleAfterSec && <Badge>stale {s.staleAfterSec}s</Badge>}
            {(s.min !== undefined || s.max !== undefined) && <Badge>{s.min ?? "−∞"}…{s.max ?? "∞"}{s.unit}</Badge>}
            {s.latency && <Badge tone="emerald">latency: {s.latency.source}{s.latency.field ? `.${s.latency.field}` : ""}</Badge>}
            {s.decoder && <Badge tone="emerald">protobuf: {s.decoder.messageType}</Badge>}
            {rt?.subErrors.get(s.id) && <Badge tone="red">{rt.subErrors.get(s.id)}</Badge>}
            <button className="btn ml-auto" onClick={() => void removeSubscription(device.id, s.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="card grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <div className="col-span-2"><Field label="Key expression"><input className="input" required value={keyexpr} onChange={(e) => setKeyexpr(e.target.value)} placeholder="robot1/sensors/**" /></Field></div>
        <Field label="Kind">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "data" | "liveliness")}>
            <option value="data">data</option><option value="liveliness">liveliness</option>
          </select>
        </Field>
        <Field label="Label"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Stale after (s)"><input className="input" type="number" value={stale} onChange={(e) => setStale(e.target.value)} /></Field>
        <Field label="Min"><input className="input" type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <Field label="Max"><input className="input" type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
        <Field label="Unit"><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="°C" /></Field>
        <Field label="Latency source (passive)">
          <select className="input" value={latSource} onChange={(e) => setLatSource(e.target.value as typeof latSource)} disabled={kind === "liveliness"}>
            <option value="">none</option>
            <option value="zenoh">zenoh timestamp</option>
            <option value="attachment">attachment (epoch)</option>
            <option value="json">JSON payload field</option>
          </select>
        </Field>
        {latSource === "json" && <Field label="JSON field"><input className="input" value={latField} onChange={(e) => setLatField(e.target.value)} placeholder="header.stamp" /></Field>}
        {(latSource === "json" || latSource === "attachment") && (
          <Field label="Epoch unit">
            <select className="input" value={latUnit} onChange={(e) => setLatUnit(e.target.value as TimeUnit)}>
              <option value="s">seconds</option><option value="ms">milliseconds</option><option value="us">microseconds</option><option value="ns">nanoseconds</option>
            </select>
          </Field>
        )}
        {latSource === "json" && (
          <Field label="ISO strings without timezone are">
            <select className="input" value={latNaive} onChange={(e) => setLatNaive(e.target.value as "utc" | "local")}>
              <option value="utc">UTC (recommended)</option><option value="local">this browser's local time</option>
            </select>
          </Field>
        )}
        <Field label="Payload decoder">
          <select className="input" value={msgType} onChange={(e) => setMsgType(e.target.value)} disabled={kind === "liveliness"}>
            <option value="">text / number / JSON</option>
            {types.map((t) => <option key={t} value={t}>protobuf: {t}</option>)}
          </select>
        </Field>
        <div className="col-span-2 md:col-span-4"><button className="btn btn-primary">Add subscription</button></div>
      </form>
    </div>
  );
}

function Schemas() {
  const { schemas, addSchemas, removeSchema } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const load = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, source: await f.text() })));
    setError(addSchemas(files) ?? "");
    if (input.current) input.current.value = "";
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-zinc-300">Protobuf schemas</h2>
        <span className="text-xs text-zinc-500">{listMessageTypes().length} message types</span>
        <button className="btn ml-auto" onClick={() => input.current?.click()}><FileCode2 size={14} /> Add .proto files</button>
        <input ref={input} type="file" multiple accept=".proto" className="hidden" onChange={(e) => void load(e.target.files)} />
      </div>
      <p className="text-xs text-zinc-500">Select a schema together with the files it imports. Then pick a message type as payload decoder when adding a subscription.</p>
      {error && <p className="break-words rounded bg-red-950 p-2 text-xs text-red-300">{error}</p>}
      {schemas.map((f) => (
        <div key={f.name} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs">{f.name}</span>
          <button className="btn ml-auto" onClick={() => removeSchema(f.name)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function Connection({ device }: { device: DeviceConfig }) {
  const { updateDevice, disconnect, connect } = useStore();
  const [url, setUrl] = useState(device.url);
  return (
    <div className="card max-w-lg space-y-3 p-4">
      <Field label="Name"><input className="input" value={device.name} onChange={(e) => updateDevice(device.id, { name: e.target.value })} /></Field>
      <Field label="Group"><input className="input" value={device.group ?? ""} onChange={(e) => updateDevice(device.id, { group: e.target.value || undefined })} /></Field>
      <Field label="WebSocket URL">
        <div className="flex gap-2">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" onClick={async () => { await disconnect(device.id); updateDevice(device.id, { url }); await connect(device.id); }}>Apply</button>
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={device.autoConnect} onChange={(e) => updateDevice(device.id, { autoConnect: e.target.checked })} /> Connect automatically at startup</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={device.readOnly} onChange={(e) => updateDevice(device.id, { readOnly: e.target.checked })} /> Read-only (hides the Publish tab)</label>
    </div>
  );
}

function Publish({ device }: { device: DeviceConfig }) {
  const rt = getRuntime(device.id);
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await rt?.put(key, text); setMsg("sent"); } catch (err) { setMsg(String(err)); }
  };
  return (
    <form onSubmit={send} className="card max-w-lg space-y-3 p-4">
      <p className="text-xs text-amber-400">Publishing affects the device. Keep devices read-only unless you need this.</p>
      <Field label="Key expression"><input className="input" required value={key} onChange={(e) => setKey(e.target.value)} /></Field>
      <Field label="Payload (text)"><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="flex items-center gap-3"><button className="btn btn-primary">Put</button><span className="text-sm text-zinc-400">{msg}</span></div>
    </form>
  );
}

function Latency({ device }: { device: DeviceConfig }) {
  const { updateDevice, updateSubscription } = useStore();
  const rt = getRuntime(device.id);
  const relative = device.latencyMode === "relative";
  const [floor, setFloor] = useState("0");
  const rows = [...(rt?.keys.values() ?? [])]
    .filter((k) => device.subscriptions.find((s) => s.id === k.subId)?.latency)
    .sort((a, b) => a.key.localeCompare(b.key));
  const configured = device.subscriptions.some((s) => s.latency);

  return (
    <div className="space-y-4">
      <div className="card space-y-1 p-4 text-sm text-zinc-300">
        <p>
          <b>Passive measurement.</b> latency = time the supervisor receives a message − send time carried in that message.
          Nothing is published or queried, so it adds no traffic and cannot delay the devices.
        </p>
        <p className="text-zinc-400">
          It is a one-way delay, so it is only meaningful when both clocks are synchronised (NTP/PTP/chrony); negative values reveal a clock offset
          (correct it in the Connection tab). It measures sender → this browser, including the bridge and WebSocket hop,
          which is a proxy for, not identical to, the delay seen by your real consumer.
        </p>
        <p className="text-zinc-400">
          <b>Clocks not in sync?</b> Epoch timestamps are UTC, so timezones don't matter. A constant clock offset does: use <i>Relative</i> mode
          (delay above the lowest seen, so variation and jitter stay valid), or correct it with a per-subscription clock offset (type it, or press Align to set it from the lowest delay seen). Clock drift slowly distorts relative mode; use Reset stats now and then.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex overflow-hidden rounded-md border border-zinc-700">
          {(["absolute", "relative"] as const).map((m) => (
            <button key={m} onClick={() => updateDevice(device.id, { latencyMode: m })}
              className={`px-3 py-1.5 capitalize ${(relative ? "relative" : "absolute") === m ? "bg-sky-700" : "bg-zinc-900 hover:bg-zinc-800"}`}>{m}</button>
          ))}
        </div>
        <span className="ml-auto text-zinc-500">assume real minimum delay</span>
        <input className="input !w-20" type="number" step="any" value={floor} onChange={(e) => setFloor(e.target.value)} />
        <span className="text-zinc-500">ms</span>
      </div>
      {!configured && <p className="text-sm text-amber-400">No subscription has a latency source yet. Set one in the Subscriptions tab.</p>}
      {configured && (
        <button className="btn" onClick={() => rt?.resetLatency()}><Eraser size={14} /> Reset stats</button>
      )}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs text-zinc-500">
            <tr><th className="px-3 py-2">Key</th><th>Last</th><th>Avg</th><th>Min</th><th>Max</th><th>Jitter</th><th>Trend</th><th>Samples</th><th>Clock offset</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-600">No data yet</td></tr>}
            {rows.map((k) => {
              const lat = relative && Number.isFinite(k.latMin) ? k.lat.map((x) => x - k.latMin) : k.lat;
              const st = latencyStats(lat);
              const sub = device.subscriptions.find((x) => x.id === k.subId)!;
              const suspicious = !relative && st && (st.min < -5 || st.min > 1000);
              return (
                <tr key={k.key} className="border-t border-zinc-800 tabular-nums">
                  <td className="px-3 py-2 font-mono text-xs">{k.key}</td>
                  {st ? (
                    <>
                      <td>{fmtMs(st.last)}</td><td>{fmtMs(st.avg)}</td><td>{fmtMs(st.min)}</td><td>{fmtMs(st.max)}</td>
                      <td>{fmtMs(st.jitter)}</td>
                      <td><Sparkline data={lat.slice(-60)} alert={st.negative > 0} /></td>
                      <td>
                        {st.n}
                        {suspicious && <span className="ml-2"><Badge tone="red">{st.min < 0 ? `${st.negative} negative` : "min > 1 s"}: likely clock offset</Badge></span>}
                      </td>
                      <td className="whitespace-nowrap">
                        <input className="input !w-24" type="number" step="any" value={sub.latency?.offsetMs ?? 0}
                          onChange={(e) => updateSubscription(device.id, sub.id, { latency: { ...sub.latency!, offsetMs: Number(e.target.value) } })} />
                        <button className="btn ml-1" title="Set this emitter's offset so its lowest latency equals the assumed minimum"
                          onClick={() => {
                            updateSubscription(device.id, sub.id, { latency: { ...sub.latency!, offsetMs: (sub.latency?.offsetMs ?? 0) + k.latMin - Number(floor) } });
                            rt?.resetLatency(sub.id);
                          }}>Align</button>
                      </td>
                    </>
                  ) : (
                    <td colSpan={8} className={k.latMissing ? "text-amber-400" : "text-zinc-500"}>
                      {k.latMissing
                        ? `no send time found in ${k.latMissing} message(s): check the source (zenoh timestamping must be enabled on the publisher or router)`
                        : "waiting for samples…"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
