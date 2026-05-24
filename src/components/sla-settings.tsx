"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSlaPolicy,
  deleteSlaPolicy,
  updateSlaPolicy,
} from "@/actions/sla";

type Policy = {
  id: string;
  name: string;
  severity: string;
  timeToAcknowledgeMinutes: number;
  timeToContainMinutes: number;
  timeToResolveMinutes: number;
};

const SEVERITIES = ["low", "medium", "high", "critical"];

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)}h`;
  return `${(m / 1440).toFixed(m % 1440 === 0 ? 0 : 1)}d`;
}

export default function SlaSettings({
  policies,
  isAdmin,
}: {
  policies: Policy[];
  isAdmin: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  const taken = new Set(policies.map((p) => p.severity));
  const availableSeverities = SEVERITIES.filter((s) => !taken.has(s));

  return (
    <div className="space-y-3">
      <table className="kelpie-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Severity</th>
            <th>Acknowledge</th>
            <th>Contain</th>
            <th>Resolve</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) =>
            editingId === p.id ? (
              <tr key={p.id}>
                <td colSpan={6}>
                  <form
                    action={async (fd) => {
                      fd.set("id", p.id);
                      await updateSlaPolicy(fd);
                      setEditingId(null);
                      router.refresh();
                    }}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <Cell label="Name">
                      <input name="name" defaultValue={p.name} className="kelpie-input" required />
                    </Cell>
                    <Cell label="Severity">
                      <span className="kelpie-badge text-slate-300">{p.severity}</span>
                    </Cell>
                    <Cell label="Ack (min)">
                      <input
                        name="ack"
                        type="number"
                        min={0}
                        defaultValue={p.timeToAcknowledgeMinutes}
                        className="kelpie-input"
                        required
                      />
                    </Cell>
                    <Cell label="Contain (min)">
                      <input
                        name="contain"
                        type="number"
                        min={0}
                        defaultValue={p.timeToContainMinutes}
                        className="kelpie-input"
                        required
                      />
                    </Cell>
                    <Cell label="Resolve (min)">
                      <input
                        name="resolve"
                        type="number"
                        min={0}
                        defaultValue={p.timeToResolveMinutes}
                        className="kelpie-input"
                        required
                      />
                    </Cell>
                    <button className="kelpie-btn kelpie-btn-primary">Save</button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <span className="kelpie-badge text-slate-300">{p.severity}</span>
                </td>
                <td className="tabular-nums">{formatMinutes(p.timeToAcknowledgeMinutes)}</td>
                <td className="tabular-nums">{formatMinutes(p.timeToContainMinutes)}</td>
                <td className="tabular-nums">{formatMinutes(p.timeToResolveMinutes)}</td>
                <td className="text-right">
                  {isAdmin ? (
                    <div className="flex justify-end gap-1">
                      <button
                        className="kelpie-btn kelpie-btn-ghost"
                        onClick={() => setEditingId(p.id)}
                      >
                        Edit
                      </button>
                      <form
                        action={async (fd) => {
                          fd.set("id", p.id);
                          if (!confirm(`Delete ${p.name}?`)) return;
                          await deleteSlaPolicy(fd);
                          router.refresh();
                        }}
                      >
                        <button className="kelpie-btn kelpie-btn-ghost text-red-400">
                          Delete
                        </button>
                      </form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ),
          )}
          {policies.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-slate-500 py-6">
                No SLA policies yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {isAdmin && availableSeverities.length > 0 ? (
        adding ? (
          <form
            action={async (fd) => {
              await createSlaPolicy(fd);
              setAdding(false);
              router.refresh();
            }}
            className="flex flex-wrap items-end gap-2 kelpie-card p-4"
          >
            <Cell label="Name">
              <input name="name" className="kelpie-input" required defaultValue="" />
            </Cell>
            <Cell label="Severity">
              <select name="severity" className="kelpie-input" defaultValue={availableSeverities[0]}>
                {availableSeverities.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Cell>
            <Cell label="Ack (min)">
              <input name="ack" type="number" min={0} className="kelpie-input" required defaultValue={30} />
            </Cell>
            <Cell label="Contain (min)">
              <input name="contain" type="number" min={0} className="kelpie-input" required defaultValue={240} />
            </Cell>
            <Cell label="Resolve (min)">
              <input name="resolve" type="number" min={0} className="kelpie-input" required defaultValue={1440} />
            </Cell>
            <button className="kelpie-btn kelpie-btn-primary">Create</button>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add policy for {availableSeverities.join(", ")}
          </button>
        )
      ) : null}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[7rem]">
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
        {label}
      </label>
      {children}
    </div>
  );
}
