"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCaseField, updateCaseStatus, updateCaseTags } from "@/actions/cases";
import { DATA_CLASSIFICATION_SUGGESTIONS, parseTagsInput } from "@/lib/tags";

type Props = {
  caseId: string;
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

export function CaseControls(props: Props) {
  const [pending, start] = useTransition();
  const [tagsInput, setTagsInput] = useState(props.tags.join(", "));
  const [dataTagsInput, setDataTagsInput] = useState(
    props.dataClassificationTags.join(", "),
  );
  const router = useRouter();

  useEffect(() => {
    setTagsInput(props.tags.join(", "));
  }, [props.tags]);

  useEffect(() => {
    setDataTagsInput(props.dataClassificationTags.join(", "));
  }, [props.dataClassificationTags]);

  function apply(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <div className="kelpie-card p-5 space-y-3">
      <h2 className="text-sm font-medium text-slate-300">Case controls</h2>
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
          onChange={(e) =>
            apply(() =>
              updateCaseField(props.caseId, "severity", e.target.value),
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
          onChange={(e) =>
            apply(() =>
              updateCaseField(
                props.caseId,
                "assigneeId",
                e.target.value || null,
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
          onChange={(e) =>
            apply(() =>
              updateCaseField(props.caseId, "classification", e.target.value),
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
          onChange={(e) =>
            apply(() => updateCaseField(props.caseId, "tlp", e.target.value))
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
          onChange={(e) =>
            apply(() => updateCaseField(props.caseId, "pap", e.target.value))
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
                apply(() =>
                  updateCaseTags(props.caseId, "tags", parseTagsInput(tagsInput)),
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
                apply(() =>
                  updateCaseTags(
                    props.caseId,
                    "dataClassificationTags",
                    parseTagsInput(dataTagsInput),
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
