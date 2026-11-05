import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DeviceRuntime } from "./runtime";
import { setProtoFiles, validateProtoFiles, type ProtoFile } from "./proto";
import type { AppConfig, DeviceConfig, Status, SubscriptionConfig } from "./types";

const runtimes = new Map<string, DeviceRuntime>();
let initPromise: Promise<void> | null = null;

export const getRuntime = (id: string) => runtimes.get(id);

const uid = () => Math.random().toString(36).slice(2, 9);

interface State {
  devices: DeviceConfig[];
  selectedId: string | null;
  seeded: boolean;
  statuses: Record<string, Status>;
  schemas: ProtoFile[];
  /** bumped ~4x/s while any runtime has new data; components read runtime data on each render */
  tick: number;

  init(): Promise<void>;
  select(id: string | null): void;
  addDevice(d: Omit<DeviceConfig, "id" | "subscriptions"> & { subscriptions?: SubscriptionConfig[] }): string;
  updateDevice(id: string, patch: Partial<Omit<DeviceConfig, "id" | "subscriptions">>): void;
  removeDevice(id: string): Promise<void>;
  addSubscription(deviceId: string, sub: Omit<SubscriptionConfig, "id">): Promise<void>;
  removeSubscription(deviceId: string, subId: string): Promise<void>;
  updateSubscription(deviceId: string, subId: string, patch: Partial<Omit<SubscriptionConfig, "id">>): void;
  /** Add (or replace by file name) .proto files. Returns an error message and changes nothing when they do not load. */
  addSchemas(files: ProtoFile[]): string | undefined;
  removeSchema(name: string): void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  importConfig(cfg: AppConfig): Promise<void>;
  exportConfig(): AppConfig;
  resetToFile(): Promise<void>;
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const onStatus = (id: string, status: Status) =>
        set((s) => ({ statuses: { ...s.statuses, [id]: status } }));

      const ensureRuntime = (cfg: DeviceConfig) => {
        let rt = runtimes.get(cfg.id);
        if (!rt) {
          rt = new DeviceRuntime(cfg, onStatus);
          runtimes.set(cfg.id, rt);
        }
        rt.cfg = cfg;
        return rt;
      };

      const patchDevice = (id: string, fn: (d: DeviceConfig) => DeviceConfig) => {
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? fn(d) : d)) }));
        const d = get().devices.find((x) => x.id === id);
        if (d) ensureRuntime(d);
      };

      return {
        devices: [],
        selectedId: null,
        seeded: false,
        statuses: {},
        schemas: [],
        tick: 0,

        init() {
          // StrictMode mounts twice in dev; run the startup sequence only once
          initPromise ??= (async () => {
          if (!get().seeded) {
            await get().resetToFile();
            set({ seeded: true });
          }
          setProtoFiles(get().schemas);
          for (const d of get().devices) {
            const rt = ensureRuntime(d);
            if (d.autoConnect) void rt.connect();
          }
          window.setInterval(() => {
            let dirty = false;
            for (const rt of runtimes.values()) {
              if (rt.dirty) {
                dirty = true;
                rt.dirty = false;
              }
            }
            // stale/age columns need to move even when no data arrives
            if (dirty || get().devices.length) set((s) => ({ tick: s.tick + 1 }));
          }, 250);
          })();
          return initPromise;
        },

        select: (id) => set({ selectedId: id }),

        addDevice(d) {
          const dev: DeviceConfig = { ...d, id: uid(), subscriptions: d.subscriptions ?? [] };
          set((s) => ({ devices: [...s.devices, dev], selectedId: dev.id }));
          const rt = ensureRuntime(dev);
          if (dev.autoConnect) void rt.connect();
          return dev.id;
        },

        updateDevice: (id, patch) => patchDevice(id, (d) => ({ ...d, ...patch })),

        async removeDevice(id) {
          await runtimes.get(id)?.disconnect();
          runtimes.delete(id);
          set((s) => ({
            devices: s.devices.filter((d) => d.id !== id),
            selectedId: s.selectedId === id ? null : s.selectedId,
          }));
        },

        async addSubscription(deviceId, sub) {
          const full: SubscriptionConfig = { ...sub, id: uid() };
          patchDevice(deviceId, (d) => ({ ...d, subscriptions: [...d.subscriptions, full] }));
          await runtimes.get(deviceId)?.addSubscription(full);
        },

        async removeSubscription(deviceId, subId) {
          patchDevice(deviceId, (d) => ({ ...d, subscriptions: d.subscriptions.filter((x) => x.id !== subId) }));
          await runtimes.get(deviceId)?.removeSubscription(subId);
        },

        updateSubscription(deviceId, subId, patch) {
          patchDevice(deviceId, (d) => ({
            ...d,
            subscriptions: d.subscriptions.map((x) => (x.id === subId ? { ...x, ...patch } : x)),
          }));
          // the runtime keeps its own copy of the config used by the live handlers
          const rt = runtimes.get(deviceId);
          const sub = get().devices.find((d) => d.id === deviceId)?.subscriptions.find((x) => x.id === subId);
          if (rt && sub) rt.updateSubscriptionConfig(sub);
        },

        addSchemas(files) {
          const next = [...get().schemas.filter((x) => !files.some((f) => f.name === x.name)), ...files];
          const err = validateProtoFiles(next);
          if (err) return err;
          setProtoFiles(next);
          set({ schemas: next });
        },

        removeSchema(name) {
          const next = get().schemas.filter((x) => x.name !== name);
          setProtoFiles(next);
          set({ schemas: next });
        },

        connect: async (id) => runtimes.get(id)?.connect(),
        disconnect: async (id) => runtimes.get(id)?.disconnect(),

        async importConfig(cfg) {
          for (const rt of runtimes.values()) await rt.disconnect();
          runtimes.clear();
          const schemas = cfg.schemas ?? [];
          setProtoFiles(schemas);
          set({ devices: cfg.devices, schemas, statuses: {}, selectedId: null });
          for (const d of cfg.devices) {
            const rt = ensureRuntime(d);
            if (d.autoConnect) void rt.connect();
          }
        },

        exportConfig: () => ({ version: 1, devices: get().devices, schemas: get().schemas }),

        async resetToFile() {
          try {
            const res = await fetch(`${import.meta.env.BASE_URL}supervisor.config.json`, { cache: "no-store" });
            if (res.ok) await get().importConfig((await res.json()) as AppConfig);
          } catch {
            /* no default config file, start empty */
          }
        },
      };
    },
    {
      name: "zenoh-supervisor",
      partialize: (s) => ({ devices: s.devices, schemas: s.schemas, selectedId: s.selectedId, seeded: s.seeded }),
    },
  ),
);
