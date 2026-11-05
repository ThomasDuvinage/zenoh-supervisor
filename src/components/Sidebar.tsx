import { useState } from "react";
import { LayoutDashboard, Plus, Download, Upload, RotateCcw, Server } from "lucide-react";
import { useStore } from "../lib/store";
import { StatusDot } from "./ui";
import { AddDeviceDialog } from "./AddDeviceDialog";
import { isDesktop, openTextFile, saveTextFile, startLocalRouter } from "../platform";

export function Sidebar() {
  const { devices, selectedId, statuses, select, exportConfig, importConfig, resetToFile, addDevice } = useStore();
  const [adding, setAdding] = useState(false);

  const groups = new Map<string, typeof devices>();
  for (const d of devices) {
    const g = d.group ?? "Ungrouped";
    groups.set(g, [...(groups.get(g) ?? []), d]);
  }

  const doExport = async () => {
    const text = JSON.stringify(exportConfig(), null, 2);
    if (isDesktop) {
      try {
        await saveTextFile("supervisor.config.json", text);
      } catch (e) {
        alert(`Export failed: ${e}`);
      }
      return;
    }
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "supervisor.config.json";
    a.click();
  };

  const doImport = async () => {
    try {
      if (isDesktop) {
        const f = await openTextFile(["json"]);
        if (f) await importConfig(JSON.parse(f.text), { file: f.path });
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = async () => {
        const f = input.files?.[0];
        if (f) await importConfig(JSON.parse(await f.text()));
      };
      input.click();
    } catch (e) {
      alert(`Import failed: ${e}`);
    }
  };

  const doLocalRouter = async () => {
    try {
      const r = await startLocalRouter();
      if (r) select(addDevice({ name: "Local router", url: r.url, group: "Local", autoConnect: true, readOnly: true }));
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight">Zenoh Supervisor</div>
      <button
        onClick={() => select(null)}
        className={`mx-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${selectedId === null ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
      >
        <LayoutDashboard size={16} /> Overview
      </button>

      <div className="mt-3 flex-1 overflow-y-auto px-2">
        {[...groups].map(([g, list]) => (
          <div key={g} className="mb-3">
            <div className="px-3 pb-1 text-xs uppercase tracking-wide text-zinc-500">{g}</div>
            {list.map((d) => (
              <button
                key={d.id}
                onClick={() => select(d.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm ${selectedId === d.id ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
              >
                <StatusDot status={statuses[d.id] ?? "disconnected"} />
                <span className="truncate">{d.name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-zinc-800 p-3">
        <button className="btn btn-primary w-full justify-center" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add connection
        </button>
        {isDesktop && (
          <button className="btn w-full justify-center" onClick={doLocalRouter} title="Pick a Zenoh config and run zenohd with it">
            <Server size={14} /> Start local router
          </button>
        )}
        <div className="flex gap-2">
          <button className="btn flex-1 justify-center" onClick={doImport} title="Import config JSON"><Upload size={14} /></button>
          <button className="btn flex-1 justify-center" onClick={doExport} title="Export config JSON"><Download size={14} /></button>
          <button className="btn flex-1 justify-center" onClick={() => confirm("Replace current setup with public/supervisor.config.json?") && resetToFile()} title="Reset to file"><RotateCcw size={14} /></button>
        </div>
      </div>
      {adding && <AddDeviceDialog onClose={() => setAdding(false)} />}
    </aside>
  );
}
