import { useStore, getRuntime } from "../lib/store";
import { mergeTopologies } from "../lib/runtime";
import { Badge, StatusDot } from "./ui";
import { TopologyGraph } from "./TopologyGraph";

export function Overview() {
  const { devices, statuses, select, connect, tick } = useStore();
  void tick;
  const now = Date.now();

  if (devices.length === 0) {
    return <p className="p-8 text-zinc-400">No connections yet. Add one from the sidebar or import a config file.</p>;
  }

  const views = devices.flatMap((d) => {
    const topology = getRuntime(d.id)?.topology;
    return topology ? [{ name: d.name, topology }] : [];
  });
  const net = views.length ? mergeTopologies(views) : null;

  return (
    <div className="space-y-4 p-6">
    {net && net.nodes.length > 1 && (
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Network ({net.nodes.length} nodes, from {views.length} connection{views.length === 1 ? "" : "s"})</h2>
        <TopologyGraph nodes={net.nodes} edges={net.edges} />
      </div>
    )}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {devices.map((d) => {
        const rt = getRuntime(d.id);
        const status = statuses[d.id] ?? "disconnected";
        let stale = 0, alerts = 0, rate = 0;
        for (const sub of d.subscriptions) {
          for (const k of rt?.keys.values() ?? []) {
            if (k.subId !== sub.id) continue;
            if (sub.staleAfterSec && now - k.lastTs > sub.staleAfterSec * 1000) stale++;
            if (typeof k.value === "number" && ((sub.min !== undefined && k.value < sub.min) || (sub.max !== undefined && k.value > sub.max))) alerts++;
          }
        }
        for (const k of rt?.keys.values() ?? []) rate += rt!.rate(k, now);
        return (
          <div key={d.id} className="card cursor-pointer p-4 hover:border-zinc-600" onClick={() => select(d.id)}>
            <div className="flex items-center gap-2">
              <StatusDot status={status} />
              <span className="font-medium">{d.name}</span>
              <span className="ml-auto text-xs text-zinc-500">{d.group}</span>
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">{d.url}</div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
              <Stat label="topics" value={rt?.keys.size ?? 0} />
              <Stat label="msg/s" value={rate.toFixed(1)} />
              <Stat label="alive" value={rt?.alive.size ?? 0} />
              <Stat label="subs" value={d.subscriptions.length} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stale > 0 && <Badge tone="amber">{stale} stale</Badge>}
              {alerts > 0 && <Badge tone="red">{alerts} out of range</Badge>}
              {rt?.error && <Badge tone="red">{rt.error.slice(0, 40)}</Badge>}
              {d.readOnly && <Badge>read-only</Badge>}
            </div>
            {status === "disconnected" && (
              <button className="btn mt-3" onClick={(e) => { e.stopPropagation(); void connect(d.id); }}>Connect</button>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-zinc-950 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
