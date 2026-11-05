import { readTextFile } from "../platform";
import type { ProtoFile } from "./proto";
import type { SchemaEntry } from "./types";

/** Where a config came from, to resolve the relative paths inside it. Unknown for a file uploaded in the browser. */
export type ConfigOrigin = { url: string } | { file: string };

const base = (path: string) => path.split(/[\\/]/).pop() ?? path;

function filePath(origin: { file: string }, path: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(path)) return path;
  return `${origin.file.replace(/[\\/][^\\/]*$/, "")}/${path}`;
}

/** Turn the schema entries of a config into inline files, reading the ones given as a path. */
export async function resolveSchemas(entries: SchemaEntry[] = [], origin?: ConfigOrigin): Promise<ProtoFile[]> {
  return Promise.all(
    entries.map(async (e) => {
      if (!("path" in e)) return e;
      const name = e.name ?? base(e.path);
      if (!origin) {
        throw new Error(`${e.path}: a schema path cannot be read from a config uploaded in the browser. Inline the source, add the .proto in the Subscriptions tab, or use the desktop app.`);
      }
      if ("file" in origin) return { name, source: await readTextFile(filePath(origin, e.path)) };
      const res = await fetch(new URL(e.path, new URL(origin.url, location.href)), { cache: "no-store" });
      if (!res.ok) throw new Error(`${e.path}: HTTP ${res.status}`);
      return { name, source: await res.text() };
    }),
  );
}
