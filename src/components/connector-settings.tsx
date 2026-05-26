"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearConnectorError,
  createConnector,
  deleteConnector,
  pollConnectorNow,
  setConnectorActive,
  updateConnectorMapping,
} from "@/actions/connectors";

type ConfigField = {
  key: string;
  label: string;
  type: "string" | "password" | "number";
  required: boolean;
  placeholder?: string;
  help?: string;
};

type Kind = {
  kind: string;
  label: string;
  description: string;
  configFields: ConfigField[];
  defaultMapping: unknown;
};

type ConnectorRow = {
  id: string;
  kind: string;
  name: string;
  isActive: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  alertsProduced: number;
  mapping: unknown;
};

export default function ConnectorSettings({
  connectors,
  kinds,
  isAdmin,
}: {
  connectors: ConnectorRow[];
  kinds: Kind[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingMapping, setEditingMapping] = useState<string | null>(null);
  const [mappingJson, setMappingJson] = useState("");
  const selected = kinds.find((k) => k.kind === kind);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("kind", kind);
      fd.set("mapping", JSON.stringify(selected?.defaultMapping ?? {}));
      await createConnector(fd);
      setAdding(false);
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="kelpie-scroll-x" tabIndex={0}>
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Last poll</th>
              <th>Alerts</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connectors.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-500 py-6">
                  No SIEM connectors configured.
                </td>
              </tr>
            ) : (
              connectors.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="text-xs uppercase text-slate-400">{c.kind}</td>
                  <td className="text-xs text-slate-400">
                    {c.lastPolledAt
                      ? new Date(c.lastPolledAt).toLocaleString()
                      : "never"}
                    {c.lastError ? (
                      <div className="text-red-400 mt-1 max-w-xs truncate">
                        {c.lastError}
                      </div>
                    ) : null}
                  </td>
                  <td>{c.alertsProduced}</td>
                  <td>
                    <span
                      className={
                        "kelpie-badge " +
                        (c.lastError
                          ? "text-red-400"
                          : c.isActive
                            ? "text-green-400"
                            : "text-slate-500")
                      }
                    >
                      {c.lastError ? "halted" : c.isActive ? "active" : "off"}
                    </span>
                  </td>
                  <td className="text-right">
                    {isAdmin ? (
                      <div className="flex justify-end gap-1">
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          disabled={busy === c.id}
                          onClick={async () => {
                            setBusy(c.id);
                            const r = await pollConnectorNow(c.id);
                            setBusy(null);
                            router.refresh();
                            alert(
                              r.error
                                ? `Poll failed: ${r.error}`
                                : `Produced ${r.produced} alert(s)`,
                            );
                          }}
                        >
                          Poll now
                        </button>
                        {c.lastError ? (
                          <button
                            className="kelpie-btn kelpie-btn-ghost text-xs"
                            onClick={async () => {
                              await clearConnectorError(c.id);
                              router.refresh();
                            }}
                          >
                            Clear error
                          </button>
                        ) : null}
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          onClick={() => {
                            setEditingMapping(c.id);
                            setMappingJson(JSON.stringify(c.mapping, null, 2));
                          }}
                        >
                          Edit mapping
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          onClick={async () => {
                            await setConnectorActive(c.id, !c.isActive);
                            router.refresh();
                          }}
                        >
                          {c.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                          onClick={async () => {
                            if (!confirm(`Delete connector "${c.name}"?`)) return;
                            await deleteConnector(c.id);
                            router.refresh();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingMapping ? (
        <form
          className="kelpie-card p-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            try {
              await updateConnectorMapping(editingMapping, mappingJson);
              setEditingMapping(null);
              setMappingJson("");
              router.refresh();
            } catch (err) {
              alert((err as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          <div>
            <h3 className="text-sm font-medium text-slate-300">
              Edit field mapping
            </h3>
            <p className="text-xs text-slate-500">
              JSON paths map vendor records to Kelpie alert fields. At minimum,
              provide title and externalRef.
            </p>
          </div>
          <textarea
            className="kelpie-input font-mono text-xs"
            rows={12}
            value={mappingJson}
            onChange={(e) => setMappingJson(e.target.value)}
            spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              onClick={() => {
                setEditingMapping(null);
                setMappingJson("");
              }}
            >
              Cancel
            </button>
            <button className="kelpie-btn kelpie-btn-primary" disabled={pending}>
              {pending ? "Saving..." : "Save mapping"}
            </button>
          </div>
        </form>
      ) : null}

      {isAdmin ? (
        adding ? (
          <form onSubmit={onCreate} className="kelpie-card p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Connector
                </label>
                <select
                  className="kelpie-input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {kinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Name
                </label>
                <input name="name" className="kelpie-input" required />
              </div>
            </div>
            {selected ? (
              <p className="text-xs text-slate-500">{selected.description}</p>
            ) : null}
            {selected?.configFields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
                <input
                  name={`config.${f.key}`}
                  type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                  className="kelpie-input"
                  placeholder={f.placeholder}
                  required={f.required}
                />
                {f.help ? (
                  <p className="text-xs text-slate-500 mt-1">{f.help}</p>
                ) : null}
              </div>
            ))}
            <p className="text-xs text-slate-500">
              The default field mapping for this connector is applied. Edit the
              mapping JSON later from the connector row.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="kelpie-btn kelpie-btn-primary" disabled={pending}>
                {pending ? "Saving..." : "Add connector"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add SIEM connector
          </button>
        )
      ) : null}
    </div>
  );
}
