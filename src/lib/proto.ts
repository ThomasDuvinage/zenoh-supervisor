import * as protobuf from "protobufjs";

/** One .proto file as loaded by the user. Kept as text so it can be persisted in the config. */
export interface ProtoFile {
  name: string;
  source: string;
}

let root: protobuf.Root | undefined;
let typeNames: string[] = [];
const typeCache = new Map<string, protobuf.Type>();

/** All files are parsed into one root, so shared definitions resolve whatever the order they were added in. */
function build(files: ProtoFile[]): protobuf.Root {
  const r = new protobuf.Root();
  for (const f of files) {
    try {
      // keepCase: decoded objects keep the field names written in the .proto (no camelCase rewrite),
      // so a latency field path matches the schema
      protobuf.parse(f.source, r, { keepCase: true });
    } catch (e) {
      throw new Error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    r.resolveAll();
  } catch (e) {
    throw new Error(`Unresolved dependency: ${e instanceof Error ? e.message : String(e)}. Add the shared .proto files too.`);
  }
  return r;
}

function collectTypes(ns: protobuf.NamespaceBase, out: string[]): string[] {
  for (const n of ns.nestedArray) {
    if (n instanceof protobuf.Type) out.push(n.fullName.replace(/^\./, ""));
    if (n instanceof protobuf.Namespace) collectTypes(n, out);
  }
  return out;
}

/** Check a set of files without touching the active schemas. Returns an error message, or undefined when valid. */
export function validateProtoFiles(files: ProtoFile[]): string | undefined {
  try {
    build(files);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Replace the active schemas. Returns an error message when they do not load (the previous ones are dropped). */
export function setProtoFiles(files: ProtoFile[]): string | undefined {
  typeCache.clear();
  root = undefined;
  typeNames = [];
  if (files.length === 0) return undefined;
  try {
    root = build(files);
    typeNames = collectTypes(root, []).sort();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Fully qualified names of every message type in the loaded schemas */
export function listMessageTypes(): string[] {
  return typeNames;
}

function lookup(name: string): protobuf.Type {
  let t = typeCache.get(name);
  if (!t) {
    if (!root) throw new Error("no Protobuf schema loaded");
    t = root.lookupType(name);
    typeCache.set(name, t);
  }
  return t;
}

/** Decode to a plain JSON-safe object: 64-bit ints and bytes become strings, enums their names. */
export function decodeProto(typeName: string, bytes: Uint8Array): unknown {
  const t = lookup(typeName);
  return t.toObject(t.decode(bytes), { longs: String, enums: String, bytes: String, defaults: true });
}

/** A successful decode does not prove the type is the right one. Re-encoding the message and getting
 *  the same bytes back is a strong hint it is: a wrong type usually leaves unknown fields behind. */
export function isCanonical(typeName: string, bytes: Uint8Array): boolean {
  const t = lookup(typeName);
  const again = t.encode(t.decode(bytes)).finish();
  if (again.length !== bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (again[i] !== bytes[i]) return false;
  return true;
}
