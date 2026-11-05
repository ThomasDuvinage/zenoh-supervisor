// The only place that knows whether we run in a browser or in the Tauri shell.
// Everything else talks to zenoh-ts over WebSocket in both cases.

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Ask for a Zenoh router config (json5), start `zenohd -c <file>` and return its remote-api ws:// URL. Desktop only. */
export async function startLocalRouter(): Promise<{ url: string; path: string } | null> {
  if (!isDesktop) return null;
  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const path = await open({ filters: [{ name: "Zenoh config", extensions: ["json5", "json"] }] });
  if (typeof path !== "string") return null;
  const url = await invoke<string>("start_router", { configPath: path });
  return { url, path };
}

export async function stopLocalRouter(): Promise<void> {
  if (!isDesktop) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_router");
}

/** Native "open file" dialog + read. null if cancelled. Desktop only. */
export async function openTextFile(extensions: string[]): Promise<string | null> {
  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const path = await open({ filters: [{ name: extensions.join(", "), extensions }] });
  return typeof path === "string" ? invoke<string>("read_text_file", { path }) : null;
}

/** Native "save as" dialog + write. Returns false if cancelled. Desktop only. */
export async function saveTextFile(defaultName: string, contents: string): Promise<boolean> {
  const [{ save }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const path = await save({ defaultPath: defaultName });
  if (!path) return false;
  await invoke("write_text_file", { path, contents });
  return true;
}
