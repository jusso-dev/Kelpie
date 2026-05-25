"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCaseField, updateCaseStatus } from "@/actions/cases";

type Props = {
  caseId: string;
  status: string;
  severity: string;
  tlp: string;
  pap: string;
  classification: string;
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
  const router = useRouter();

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
