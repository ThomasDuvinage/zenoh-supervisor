import type { Status } from "../lib/types";

const COLORS: Record<Status, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-400 animate-pulse",
  error: "bg-red-500",
  disconnected: "bg-zinc-600",
};

export function StatusDot({ status }: { status: Status }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLORS[status]}`} title={status} />;
}

export function Badge({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "red" | "amber" | "emerald" }) {
  const tones = {
    zinc: "bg-zinc-800 text-zinc-300",
    red: "bg-red-950 text-red-300",
    amber: "bg-amber-950 text-amber-300",
    emerald: "bg-emerald-950 text-emerald-300",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

export function Sparkline({ data, alert }: { data: number[]; alert?: boolean }) {
  if (data.length < 2) return <span className="text-zinc-600">–</span>;
  const w = 90, h = 24;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={alert ? "#f87171" : "#38bdf8"} strokeWidth="1.5" />
    </svg>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function fmtValue(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "string") return v.length > 120 ? v.slice(0, 120) + "…" : v;
  const s = JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

export function fmtAge(ms: number): string {
  if (ms < 1000) return "now";
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  return `${Math.floor(ms / 60000)}m ago`;
}
