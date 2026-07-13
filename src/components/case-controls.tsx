"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCaseField, updateCaseStatus, updateCaseTags } from "@/actions/cases";
import { DATA_CLASSIFICATION_SUGGESTIONS, parseTagsInput } from "@/lib/tags";
import { FieldLock, useCaseCollaboration } from "@/components/case-collaboration";

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

type Conflict = {
  field: string;
  label: string;
  mine: string;
  theirs: string;
  version: number;
  options?: Array<{ value: string; label: string }>;
  submit: (value: string, version: number) => Promise<FieldResult>;
};

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
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeValue, setMergeValue] = useState("");
  const router = useRouter();
  const { beginEditing, endEditing, lockedBy } = useCaseCollaboration();

  useEffect(() => {
    setTagsInput(props.tags.join(", "));
  }, [props.tags]);

  useEffect(() => {
    setDataTagsInput(props.dataClassificationTags.join(", "));
  }, [props.dataClassificationTags]);

  function applyGuarded(
    field: string,
    label: string,
    mine: string,
    submit: (value: string, version: number) => Promise<FieldResult>,
    options?: Array<{ value: string; label: string }>,
    version = props.version,
  ) {
    start(async () => {
      const res = await submit(mine, version);
      if (!res.ok) {
        const theirs = res.conflict[field];
        const nextConflict = {
          field,
          label,
          mine,
          theirs: Array.isArray(theirs) ? theirs.join(", ") : String(theirs ?? ""),
          version: Number(res.conflict.version),
          options,
          submit,
        };
        setConflict(nextConflict);
        setMergeValue(mine);
        setMergeOpen(false);
        return;
      }
      setConflict(null);
      setMergeOpen(false);
      router.refresh();
    });
  }

  function resolveConflict(value: string) {
    if (!conflict) return;
    applyGuarded(
      conflict.field,
      conflict.label,
      value,
      conflict.submit,
      conflict.options,
      conflict.version,
    );
  }

  const optionList = (values: readonly string[]) =>
    values.map((value) => ({ value, label: value.replace(/_/g, " ") }));

  return (
    <div className="kelpie-card p-5 space-y-3">
      <h2 className="text-sm font-medium text-slate-300">Case controls</h2>
      {conflict ? (
        <div className="rounded border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100 space-y-2">
          <p role="alert">
            Another analyst changed <strong>{conflict.label}</strong> while you
            were editing.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-amber-50">
            <dt className="text-amber-300">Theirs</dt>
            <dd className="break-words">{conflict.theirs.replace(/_/g, " ") || "Empty"}</dd>
            <dt className="text-amber-300">Yours</dt>
            <dd className="break-words">{conflict.mine.replace(/_/g, " ") || "Empty"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              className="kelpie-btn kelpie-btn-ghost text-xs"
              onClick={() => {
                setConflict(null);
                setMergeOpen(false);
                router.refresh();
              }}
            >
              Keep theirs
            </button>
            <button
              className="kelpie-btn kelpie-btn-secondary text-xs"
              onClick={() => resolveConflict(conflict.mine)}
              disabled={pending}
            >
              Keep mine
            </button>
            <button
              className="kelpie-btn kelpie-btn-secondary text-xs"
              onClick={() => setMergeOpen(true)}
              disabled={pending}
            >
              Merge
            </button>
          </div>
          {mergeOpen ? (
            <div className="space-y-2 border-t border-amber-800/60 pt-2">
              <label htmlFor="case-conflict-merge" className="block text-amber-200">
                Merged value
              </label>
              {conflict.options ? (
                <select
                  id="case-conflict-merge"
                  className="kelpie-input"
                  value={mergeValue}
                  onChange={(event) => setMergeValue(event.target.value)}
                >
                  {conflict.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <textarea
                  id="case-conflict-merge"
                  className="kelpie-input"
                  rows={3}
                  value={mergeValue}
                  onChange={(event) => setMergeValue(event.target.value)}
                />
              )}
              <button
                className="kelpie-btn kelpie-btn-primary text-xs"
                onClick={() => resolveConflict(mergeValue)}
                disabled={pending}
              >
                Save merged value
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <Row label="Status" htmlFor="case-status">
        <select
          id="case-status"
          className="kelpie-input"
          value={props.status}
          disabled={pending || props.status === "closed" || Boolean(lockedBy("status"))}
          onFocus={() => beginEditing("status")}
          onBlur={() => endEditing("status")}
          onChange={(e) =>
            applyGuarded(
              "status",
              "Status",
              e.target.value,
              (value, version) =>
                updateCaseStatus(props.caseId, value as CaseStatusOpt, version),
              optionList(STATUS_OPTIONS),
            )
          }
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <FieldLock field="status" />
      </Row>
      <Row label="Severity" htmlFor="case-severity">
        <select
          id="case-severity"
          className="kelpie-input"
          value={props.severity}
          disabled={pending || Boolean(lockedBy("severity"))}
          onFocus={() => beginEditing("severity")}
          onBlur={() => endEditing("severity")}
          onChange={(e) =>
            applyGuarded(
              "severity",
              "Severity",
              e.target.value,
              (value, version) => updateCaseField(props.caseId, "severity", value, version),
              optionList(SEVERITY_OPTIONS),
            )
          }
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <FieldLock field="severity" />
      </Row>
      <Row label="Assignee" htmlFor="case-assignee">
        <select
          id="case-assignee"
          className="kelpie-input"
          value={props.assigneeId ?? ""}
          disabled={pending || Boolean(lockedBy("assigneeId"))}
          onFocus={() => beginEditing("assigneeId")}
          onBlur={() => endEditing("assigneeId")}
          onChange={(e) =>
            applyGuarded(
              "assigneeId",
              "Assignee",
              e.target.value,
              (value, version) =>
                updateCaseField(props.caseId, "assigneeId", value || null, version),
              [
                { value: "", label: "Unassigned" },
                ...props.users.map((user) => ({ value: user.id, label: user.name })),
              ],
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
        <FieldLock field="assigneeId" />
      </Row>
      <Row label="Classification" htmlFor="case-classification">
        <select
          id="case-classification"
          className="kelpie-input"
          value={props.classification}
          disabled={pending || Boolean(lockedBy("classification"))}
          onFocus={() => beginEditing("classification")}
          onBlur={() => endEditing("classification")}
          onChange={(e) =>
            applyGuarded(
              "classification",
              "Classification",
              e.target.value,
              (value, version) => updateCaseField(props.caseId, "classification", value, version),
              optionList(CLASSIFICATION_OPTIONS),
            )
          }
        >
          {CLASSIFICATION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <FieldLock field="classification" />
      </Row>
      <Row label="TLP" htmlFor="case-tlp">
        <select
          id="case-tlp"
          className="kelpie-input"
          value={props.tlp}
          disabled={pending || Boolean(lockedBy("tlp"))}
          onFocus={() => beginEditing("tlp")}
          onBlur={() => endEditing("tlp")}
          onChange={(e) =>
            applyGuarded(
              "tlp",
              "TLP",
              e.target.value,
              (value, version) => updateCaseField(props.caseId, "tlp", value, version),
              optionList(TLP_OPTIONS),
            )
          }
        >
          {TLP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, "+")}
            </option>
          ))}
        </select>
        <FieldLock field="tlp" />
      </Row>
      <Row label="PAP" htmlFor="case-pap">
        <select
          id="case-pap"
          className="kelpie-input"
          value={props.pap}
          disabled={pending || Boolean(lockedBy("pap"))}
          onFocus={() => beginEditing("pap")}
          onBlur={() => endEditing("pap")}
          onChange={(e) =>
            applyGuarded(
              "pap",
              "PAP",
              e.target.value,
              (value, version) => updateCaseField(props.caseId, "pap", value, version),
              optionList(PAP_OPTIONS),
            )
          }
        >
          {PAP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <FieldLock field="pap" />
      </Row>
      <Row label="Tags" htmlFor="case-tags">
        <div className="flex flex-col gap-2">
          <input
            id="case-tags"
            className="kelpie-input"
            value={tagsInput}
            disabled={pending || Boolean(lockedBy("tags"))}
            onFocus={() => beginEditing("tags")}
            onBlur={() => endEditing("tags")}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="ransomware, vip, watchlist"
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending || Boolean(lockedBy("tags"))}
              onClick={() =>
                applyGuarded(
                  "tags",
                  "Tags",
                  tagsInput,
                  (value, version) =>
                    updateCaseTags(props.caseId, "tags", parseTagsInput(value), version),
                )
              }
            >
              Save tags
            </button>
          </div>
          <FieldLock field="tags" />
        </div>
      </Row>
      <Row label="Data tags" htmlFor="case-data-tags">
        <div className="flex flex-col gap-2">
          <input
            id="case-data-tags"
            className="kelpie-input"
            value={dataTagsInput}
            disabled={pending || Boolean(lockedBy("dataClassificationTags"))}
            onFocus={() => beginEditing("dataClassificationTags")}
            onBlur={() => endEditing("dataClassificationTags")}
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
              disabled={pending || Boolean(lockedBy("dataClassificationTags"))}
              onClick={() =>
                applyGuarded(
                  "dataClassificationTags",
                  "Data tags",
                  dataTagsInput,
                  (value, version) =>
                    updateCaseTags(
                      props.caseId,
                      "dataClassificationTags",
                      parseTagsInput(value),
                      version,
                    ),
                )
              }
            >
              Save data tags
            </button>
          </div>
          <FieldLock field="dataClassificationTags" />
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
