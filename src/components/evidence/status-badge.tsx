import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending_scan: { label: "Scanning…", className: "text-amber-400" },
  available: { label: "Available", className: "text-green-400" },
  quarantined: { label: "Quarantined", className: "text-red-400" },
  scan_failed: { label: "Scan failed", className: "text-red-400" },
};

export function EvidenceStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status.replace(/_/g, " "),
    className: "text-slate-300",
  };
  return <span className={cn("kelpie-badge", meta.className)}>{meta.label}</span>;
}

const RELEVANCE_META: Record<string, { label: string; className: string }> = {
  unknown: { label: "Unknown", className: "text-slate-300" },
  relevant: { label: "Relevant", className: "text-green-400" },
  not_relevant: { label: "Not relevant", className: "text-slate-500" },
};

export function EvidenceRelevanceBadge({ relevance }: { relevance: string }) {
  const meta = RELEVANCE_META[relevance] ?? {
    label: relevance.replace(/_/g, " "),
    className: "text-slate-300",
  };
  return <span className={cn("kelpie-badge", meta.className)}>{meta.label}</span>;
}
