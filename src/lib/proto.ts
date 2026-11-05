import * as protobuf from "protobufjs";

// protobufjs is only used to parse .proto files into a schema. Its own encode/decode/toObject build
// functions with `new Function`, which the desktop app's CSP forbids (and which cannot load `long` in a
// browser bundle, so 64-bit integers would lose precision). Decoding is done below instead.

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

const MASK64 = (1n << 64n) - 1n;

class Reader {
  pos = 0;
  private view: DataView;
  constructor(private buf: Uint8Array, public end = buf.length) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private need(n: number) {
    if (this.pos + n > this.end) throw new RangeError("unexpected end of message");
  }

  /** low 32 bits of a varint (tags, lengths, int32, enums, bool) */
  varint32(): number {
    let r = 0;
    for (let shift = 0, i = 0; ; shift += 7, i++) {
      this.need(1);
      const b = this.buf[this.pos++];
      if (shift < 32) r |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return r;
      if (i >= 9) throw new Error("varint too long");
    }
  }

  varint64(): bigint {
    let r = 0n;
    for (let shift = 0n, i = 0; ; shift += 7n, i++) {
      this.need(1);
      const b = this.buf[this.pos++];
      r |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return r & MASK64;
      if (i >= 9) throw new Error("varint too long");
    }
  }

  fixed32(): number { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  sfixed32(): number { this.need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  float(): number { this.need(4); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  double(): number { this.need(8); const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  fixed64(): bigint { this.need(8); const v = this.view.getBigUint64(this.pos, true); this.pos += 8; return v; }
  sfixed64(): bigint { this.need(8); const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return v; }

  bytes(): Uint8Array {
    const n = this.varint32() >>> 0;
    this.need(n);
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0: this.varint64(); break;
      case 1: this.need(8); this.pos += 8; break;
      case 2: this.bytes(); break;
      case 5: this.need(4); this.pos += 4; break;
      default: throw new Error(`unsupported wire type ${wireType}`);
    }
  }
}

const decoder = new TextDecoder();
const VARINT = new Set(["int32", "uint32", "sint32", "int64", "uint64", "sint64", "bool"]);
const FIXED64 = new Set(["double", "fixed64", "sfixed64"]);
const FIXED32 = new Set(["float", "fixed32", "sfixed32"]);

function wireTypeOf(type: string, resolved: protobuf.ReflectionObject | null): number {
  if (resolved instanceof protobuf.Enum || VARINT.has(type)) return 0;
  if (FIXED64.has(type)) return 1;
  if (FIXED32.has(type)) return 5;
  return 2;
}

/** a varint-encoded, fixed-width or enum value: the kinds a repeated field may pack */
const packable = (type: string, resolved: protobuf.ReflectionObject | null) => wireTypeOf(type, resolved) !== 2;

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function defaultFor(type: string, resolved: protobuf.ReflectionObject | null): unknown {
  if (resolved instanceof protobuf.Enum) return resolved.valuesById[0] ?? 0;
  if (resolved instanceof protobuf.Type) return null;
  if (type === "string" || type === "bytes") return "";
  if (type === "bool") return false;
  if (/64$/.test(type)) return "0";
  return 0;
}

function defaultOf(f: protobuf.Field): unknown {
  if (f.map) return {};
  if (f.repeated) return [];
  return defaultFor(f.type, f.resolvedType);
}

function readScalar(r: Reader, type: string, resolved: protobuf.ReflectionObject | null, st: { clean: boolean }): unknown {
  if (resolved instanceof protobuf.Enum) {
    const n = r.varint32() | 0;
    return resolved.valuesById[n] ?? n;
  }
  if (resolved instanceof protobuf.Type) return readMessage(resolved, new Reader(r.bytes()), st);
  switch (type) {
    case "double": return r.double();
    case "float": return r.float();
    case "int32": return r.varint32() | 0;
    case "uint32": return r.varint32() >>> 0;
    case "sint32": { const v = r.varint32() >>> 0; return (v >>> 1) ^ -(v & 1); }
    case "fixed32": return r.fixed32();
    case "sfixed32": return r.sfixed32();
    case "bool": return r.varint64() !== 0n;
    case "int64": return BigInt.asIntN(64, r.varint64()).toString();
    case "uint64": return r.varint64().toString();
    case "sint64": { const v = r.varint64(); return ((v >> 1n) ^ -(v & 1n)).toString(); }
    case "fixed64": return r.fixed64().toString();
    case "sfixed64": return r.sfixed64().toString();
    case "string": return decoder.decode(r.bytes());
    case "bytes": return toBase64(r.bytes());
  }
  throw new Error(`unsupported field type ${type}`);
}

function readMessage(type: protobuf.Type, r: Reader, st: { clean: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of type.fieldsArray) if (!f.partOf) out[f.name] = defaultOf(f);

  while (r.pos < r.end) {
    const tag = r.varint32() >>> 0;
    const field = type.fieldsById[tag >>> 3];
    const wt = tag & 7;
    if (!field) {
      st.clean = false; // a field the schema does not know
      r.skip(wt);
      continue;
    }
    const resolved = field.resolvedType;
    const expected = field instanceof protobuf.MapField ? 2 : wireTypeOf(field.type, resolved);

    if (field instanceof protobuf.MapField) {
      if (wt !== 2) { st.clean = false; r.skip(wt); continue; }
      const entry = new Reader(r.bytes());
      const keyType = field.keyType;
      let key = defaultFor(keyType, null);
      let value = defaultFor(field.type, resolved);
      while (entry.pos < entry.end) {
        const t = entry.varint32() >>> 0;
        if (t >>> 3 === 1) key = readScalar(entry, keyType, null, st);
        else if (t >>> 3 === 2) value = readScalar(entry, field.type, resolved, st);
        else { st.clean = false; entry.skip(t & 7); }
      }
      (out[field.name] as Record<string, unknown>)[String(key)] = value;
    } else if (field.repeated) {
      const list = out[field.name] as unknown[];
      if (wt === 2 && packable(field.type, resolved)) {
        const packed = new Reader(r.bytes());
        while (packed.pos < packed.end) list.push(readScalar(packed, field.type, resolved, st));
      } else if (wt === expected) {
        list.push(readScalar(r, field.type, resolved, st));
      } else { st.clean = false; r.skip(wt); }
    } else if (wt === expected) {
      out[field.name] = readScalar(r, field.type, resolved, st);
    } else {
      st.clean = false; // wire type does not fit the declared type
      r.skip(wt);
    }
  }
  return out;
}

function decode(typeName: string, bytes: Uint8Array): { value: unknown; clean: boolean } {
  const st = { clean: true };
  return { value: readMessage(lookup(typeName), new Reader(bytes), st), clean: st.clean };
}

/** Decode to a plain JSON-safe object: 64-bit ints and bytes (base64) become strings, enums their names,
 *  missing fields their default. Throws when the bytes are not a valid message. */
export function decodeProto(typeName: string, bytes: Uint8Array): unknown {
  return decode(typeName, bytes).value;
}

/** A successful decode does not prove the type is the right one. A wrong type usually meets field numbers
 *  the schema does not have, or fields on the wire with a type that does not fit: this is false then. */
export function matchesSchema(typeName: string, bytes: Uint8Array): boolean {
  try {
    return decode(typeName, bytes).clean;
  } catch {
    return false;
  }
}
