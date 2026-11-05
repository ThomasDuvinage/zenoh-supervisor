import { useState } from "react";
import type { NodeRole, TopoEdge, TopoNode } from "../lib/runtime";

type GraphNode = TopoNode & { names?: string[] };

const W = 640, H = 360;
const COLOR: Record<NodeRole, string> = { router: "#38bdf8", peer: "#34d399", client: "#a1a1aa", unknown: "#38bdf8" };

function layout(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const selves = nodes.filter((n) => n.self);
  const others = nodes.filter((n) => !n.self);
  // one bridge: centre it and ring the rest. Several: put everything on one ring.
  const ring = selves.length === 1 ? others : nodes;
  if (selves.length === 1) pos.set(selves[0].zid, { x: W / 2, y: H / 2 });
  ring.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(ring.length, 1) - Math.PI / 2;
    pos.set(n.zid, { x: W / 2 + Math.cos(a) * (W / 2 - 90), y: H / 2 + Math.sin(a) * (H / 2 - 50) });
  });
  return pos;
}

export const shortZid = (z: string) => z.slice(0, 8);

export function TopologyGraph({ nodes, edges }: { nodes: GraphNode[]; edges: TopoEdge[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const pos = layout(nodes);
  const edgeKey = (e: TopoEdge) => `${e.a}|${e.b}`;
  const hovered = edges.find((e) => edgeKey(e) === hover);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md bg-zinc-950">
        {edges.map((e) => {
          const a = pos.get(e.a), b = pos.get(e.b);
          if (!a || !b) return null;
          return (
            <g key={edgeKey(e)} onMouseEnter={() => setHover(edgeKey(e))} onMouseLeave={() => setHover(null)}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="14" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={hover === edgeKey(e) ? "#e4e4e7" : "#52525b"} strokeWidth="1.5" strokeDasharray={e.multicast ? "4 3" : undefined} />
              {e.links.length > 1 && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="fill-zinc-500 text-[10px]">×{e.links.length}</text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.zid)!;
          const fill = COLOR[n.role];
          const label = n.names?.length ? n.names.join(", ") : shortZid(n.zid);
          return (
            <g key={n.zid}>
              {n.role === "peer" || n.role === "client"
                ? <circle cx={p.x} cy={p.y} r={n.role === "client" ? 8 : 12} fill={fill} stroke={n.self ? "#fff" : "none"} strokeWidth="2" />
                : <rect x={p.x - 13} y={p.y - 13} width="26" height="26" rx="4" fill={fill} stroke={n.self ? "#fff" : "none"} strokeWidth="2" />}
              <text x={p.x} y={p.y + 28} textAnchor="middle" className="fill-zinc-300 text-[11px]">{label}</text>
              <title>{n.zid} ({n.role}{n.self ? ", bridge" : ""})</title>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>■ router / bridge</span><span>● peer</span><span>• client</span><span>white outline = bridge (session the supervisor talks to)</span><span>dashed = multicast</span>
      </div>
      {hovered && (
        <div className="mt-2 rounded-md bg-zinc-900 p-2 font-mono text-xs text-zinc-300">
          {hovered.links.length === 0 && "no link details"}
          {hovered.links.map((l, i) => <div key={i}>{l.src} → {l.dst} · mtu {l.mtu}{l.streamed ? " · streamed" : ""}</div>)}
        </div>
      )}
    </div>
  );
}
