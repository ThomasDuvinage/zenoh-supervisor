import { useEffect } from "react";
import { useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { Overview } from "./components/Overview";
import { DeviceView } from "./components/DeviceView";

export function App() {
  const { devices, selectedId, init } = useStore();
  useEffect(() => {
    void init();
  }, [init]);

  const selected = devices.find((d) => d.id === selectedId);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {selected ? <DeviceView key={selected.id} device={selected} /> : <Overview />}
      </main>
    </div>
  );
}
