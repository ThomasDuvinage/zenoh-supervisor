import { useState } from "react";
import { useStore } from "../lib/store";
import { Field } from "./ui";

export function AddDeviceDialog({ onClose }: { onClose: () => void }) {
  const addDevice = useStore((s) => s.addDevice);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("ws://127.0.0.1:10000");
  const [group, setGroup] = useState("");
  const [key, setKey] = useState("");
  const [readOnly, setReadOnly] = useState(true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    addDevice({
      name: name || url,
      url,
      group: group || undefined,
      autoConnect: true,
      readOnly,
      subscriptions: key ? [{ id: "s0", keyexpr: key, kind: "data" }] : [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/60" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-[26rem] space-y-3 bg-zinc-900 p-5">
        <h2 className="text-lg font-semibold">Add connection</h2>
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Robot 1" autoFocus /></Field>
        <Field label="WebSocket URL (remote-api bridge)"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} required /></Field>
        <Field label="Group (optional)"><input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Fleet A" /></Field>
        <Field label="First subscription (optional)"><input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="robot1/**" /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only (never publish)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Connect</button>
        </div>
      </form>
    </div>
  );
}
