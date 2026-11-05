// Downloads zenohd + the remote-api plugin for one target into src-tauri/ so Tauri can bundle them.
//   node scripts/fetch-zenoh.mjs [target-triple]     (default: this machine's rustc host)
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const VERSION = process.env.ZENOH_VERSION ?? "1.10.1"; // zenohd and the plugin must be the same version
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const triple =
  process.argv[2] ?? execSync("rustc -vV").toString().match(/^host: (.+)$/m)[1];
const win = triple.includes("windows");

const download = async (repo, prefix) => {
  const name = `${prefix}-${VERSION}-${triple}-standalone.zip`;
  const url = `https://github.com/eclipse-zenoh/${repo}/releases/download/${VERSION}/${name}`;
  console.log("get", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new AdmZip(Buffer.from(await res.arrayBuffer()));
};

const pick = (zip, re) => {
  const e = zip.getEntries().find((x) => !x.isDirectory && re.test(x.entryName));
  if (!e) throw new Error(`no file matching ${re} in ${zip.getEntries().map((x) => x.entryName)}`);
  return e;
};

const out = (dir, file, data, exec) => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  writeFileSync(p, data);
  if (exec) chmodSync(p, 0o755);
  console.log("->", p);
};

// zenohd -> binaries/supervisor-zenohd-<triple>[.exe]  (Tauri externalBin naming; the name avoids
// clashing with a system zenohd when installed to /usr/bin)
const core = await download("zenoh", "zenoh");
const bin = pick(core, win ? /(^|\/)zenohd\.exe$/ : /(^|\/)zenohd$/);
out(join(root, "binaries"), `supervisor-zenohd-${triple}${win ? ".exe" : ""}`, bin.getData(), true);

// plugin library -> zenoh-plugins/ (bundled as a resource)
const ts = await download("zenoh-ts", "zenoh-ts");
const lib = pick(ts, /(^|\/)(lib)?zenoh_plugin_remote_api\.(so|dll|dylib)$/);
out(join(root, "zenoh-plugins"), lib.entryName.split("/").pop(), lib.getData(), true);

// licenses of the redistributed binaries
for (const z of [core, ts]) {
  const l = z.getEntries().find((x) => /(^|\/)LICENSE/i.test(x.entryName) && !x.isDirectory);
  if (l) out(join(root, "zenoh-plugins"), `LICENSE-${l.entryName.split("/").pop()}`.replace(/\.(txt|md)$/, "") + (z === core ? "-zenoh" : "-zenoh-ts"), l.getData(), false);
}
