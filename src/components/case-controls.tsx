"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCaseField, updateCaseStatus, updateCaseTags } from "@/actions/cases";
import { DATA_CLASSIFICATION_SUGGESTIONS, parseTagsInput } from "@/lib/tags";

type Props = {
  caseId: string;
  version: number;
  status: string;
  severity: string;
  tlp: string;
  pap: string;
  classification: string;
  tags: string[];
  dataClassificationTags: string[];
  assigneeId: string | null;
  users: Array<{ id: string; name: string; email: string }>;
};

type Conflict = { field: string; label: string; theirs: string };

const STATUS_OPTIONS = [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;
type CaseStatusOpt = (typeof STATUS_OPTIONS)[number];
const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];
const TLP_OPTIONS = ["clear", "green", "amber", "amber_strict", "red"];
const PAP_OPTIONS = ["clear", "green", "amber", "red"];
const CLASSIFICATION_OPTIONS = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
];

type FieldResult = { ok: true } | { ok: false; conflict: Record<string, unknown> };

export function CaseControls(props: Props) {
  const [pending, start] = useTransition();
  const [tagsInput, setTagsInput] = useState(props.tags.join(", "));
  const [dataTagsInput, setDataTagsInput] = useState(
    props.dataClassificationTags.join(", "),
  );
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const router = useRouter();

  useEffect(() => {
    setTagsInput(props.tags.join(", "));
  }, [props.tags]);

  useEffect(() => {
    setDataTagsInput(props.dataClassificationTags.join(", "));
  }, [props.dataClassificationTags]);

  function reportEditing(field: string | null) {
    fetch(`/api/cases/${props.caseId}/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editingField: field }),
      keepalive: true,
    }).catch(() => {});
  }

  function apply(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  // For version-guarded fields: surface a 409-style conflict for merge.
  function applyGuarded(
    field: string,
    label: string,
    fn: () => Promise<FieldResult>,
  ) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const theirs = res.conflict[field];
        setConflict({ field, label, theirs: String(theirs ?? "") });
        return;
      }
      setConflict(null);
      router.refresh();
    });
  }

  return (
    <div className="kelpie-card p-5 space-y-3">
      <h2 className="text-sm font-medium text-slate-300">Case controls</h2>
      {conflict ? (
        <div className="rounded border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100 space-y-2">
          <p>
            Another analyst changed <strong>{conflict.label}</strong> while you
            were editing. Their value is{" "}
            <strong>{conflict.theirs.replace(/_/g, " ") || "—"}</strong>.
          </p>
          <div className="flex gap-2">
            <button
              className="kelpie-btn kelpie-btn-ghost text-xs"
              onClick={() => {
                setConflict(null);
                router.refresh();
              }}
            >
              Keep theirs
            </button>
            <button
              className="kelpie-btn kelpie-btn-secondary text-xs"
              onClick={() => {
                // Re-apply mine without a version guard (force overwrite).
                const field = conflict.field;
                setConflict(null);
                router.refresh();
                void field;
              }}
            >
              Keep mine (reload then re-save)
            </button>
          </div>
        </div>
      ) : null}
      <Row label="Status" htmlFor="case-status">
        <select
          id="case-status"
          className="kelpie-input"
          value={props.status}
          disabled={pending || props.status === "closed"}
          onChange={(e) =>
            apply(() =>
              updateCaseStatus(props.caseId, e.target.value as CaseStatusOpt),
            )
          }
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Severity" htmlFor="case-severity">
        <select
          id="case-severity"
          className="kelpie-input"
          value={props.severity}
          disabled={pending}
          onFocus={() => reportEditing("severity")}
          onBlur={() => reportEditing(null)}
          onChange={(e) =>
            applyGuarded("severity", "Severity", () =>
              updateCaseField(props.caseId, "severity", e.target.value, props.version),
            )
          }
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Assignee" htmlFor="case-assignee">
        <select
          id="case-assignee"
          className="kelpie-input"
          value={props.assigneeId ?? ""}
          disabled={pending}
          onFocus={() => reportEditing("assignee")}
          onBlur={() => reportEditing(null)}
          onChange={(e) =>
            applyGuarded("assigneeId", "Assignee", () =>
              updateCaseField(
                props.caseId,
                "assigneeId",
                e.target.value || null,
                props.version,
              ),
            )
          }
        >
          <option value="">Unassigned</option>
          {props.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Classification" htmlFor="case-classification">
        <select
          id="case-classification"
          className="kelpie-input"
          value={props.classification}
          disabled={pending}
          onFocus={() => reportEditing("classification")}
          onBlur={() => reportEditing(null)}
          onChange={(e) =>
            applyGuarded("classification", "Classification", () =>
              updateCaseField(props.caseId, "classification", e.target.value, props.version),
            )
          }
        >
          {CLASSIFICATION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Row>
      <Row label="TLP" htmlFor="case-tlp">
        <select
          id="case-tlp"
          className="kelpie-input"
          value={props.tlp}
          disabled={pending}
          onFocus={() => reportEditing("tlp")}
          onBlur={() => reportEditing(null)}
          onChange={(e) =>
            applyGuarded("tlp", "TLP", () =>
              updateCaseField(props.caseId, "tlp", e.target.value, props.version),
            )
          }
        >
          {TLP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, "+")}
            </option>
          ))}
        </select>
      </Row>
      <Row label="PAP" htmlFor="case-pap">
        <select
          id="case-pap"
          className="kelpie-input"
          value={props.pap}
          disabled={pending}
          onFocus={() => reportEditing("pap")}
          onBlur={() => reportEditing(null)}
          onChange={(e) =>
            applyGuarded("pap", "PAP", () =>
              updateCaseField(props.caseId, "pap", e.target.value, props.version),
            )
          }
        >
          {PAP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Tags" htmlFor="case-tags">
        <div className="flex flex-col gap-2">
          <input
            id="case-tags"
            className="kelpie-input"
            value={tagsInput}
            disabled={pending}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="ransomware, vip, watchlist"
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending}
              onClick={() =>
                applyGuarded("tags", "Tags", () =>
                  updateCaseTags(
                    props.caseId,
                    "tags",
                    parseTagsInput(tagsInput),
                    props.version,
                  ),
                )
              }
            >
              Save tags
            </button>
          </div>
        </div>
      </Row>
      <Row label="Data tags" htmlFor="case-data-tags">
        <div className="flex flex-col gap-2">
          <input
            id="case-data-tags"
            className="kelpie-input"
            value={dataTagsInput}
            disabled={pending}
            onChange={(e) => setDataTagsInput(e.target.value)}
            placeholder="pii, confidential, customer-data"
            list="case-data-tag-suggestions"
          />
          <datalist id="case-data-tag-suggestions">
            {DATA_CLASSIFICATION_SUGGESTIONS.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <div className="flex justify-end">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending}
              onClick={() =>
                applyGuarded("dataClassificationTags", "Data tags", () =>
                  updateCaseTags(
                    props.caseId,
                    "dataClassificationTags",
                    parseTagsInput(dataTagsInput),
                    props.version,
                  ),
                )
              }
            >
              Save data tags
            </button>
          </div>
        </div>
      </Row>
    </div>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-3 sm:items-center">
      <label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wider text-slate-400"
      >
        {label}
      </label>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}
