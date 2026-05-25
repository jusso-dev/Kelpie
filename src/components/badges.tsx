import { cn } from "@/lib/utils";

const severityColours: Record<string, string> = {
  low: "text-[color:var(--color-sev-low)]",
  medium: "text-[color:var(--color-sev-medium)]",
  high: "text-[color:var(--color-sev-high)]",
  critical: "text-[color:var(--color-sev-critical)]",
};

const statusColours: Record<string, string> = {
  open: "text-[color:var(--color-status-open)]",
  in_progress: "text-[color:var(--color-status-progress)]",
  contained: "text-[color:var(--color-status-contained)]",
  eradicated: "text-[color:var(--color-status-eradicated)]",
  recovered: "text-[color:var(--color-status-recovered)]",
  closed: "text-[color:var(--color-status-closed)]",
};

const tlpColours: Record<string, string> = {
  clear: "text-slate-300",
  green: "text-green-400",
  amber: "text-amber-400",
  amber_strict: "text-amber-300",
  red: "text-red-400",
};

const alertStatusColours: Record<string, string> = {
  new: "text-[color:var(--color-status-open)]",
  triaged: "text-[color:var(--color-status-progress)]",
  dismissed: "text-slate-400",
  promoted: "text-[color:var(--color-status-recovered)]",
};

const taskStatusColours: Record<string, string> = {
  todo: "text-slate-300",
  in_progress: "text-yellow-400",
  done: "text-green-400",
  blocked: "text-red-400",
};

export function SeverityBadge({ value }: { value: string }) {
  return (
    <span className={cn("kelpie-badge", severityColours[value] ?? "text-slate-300")}>
      {value}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={cn("kelpie-badge", statusColours[value] ?? "text-slate-300")}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function TlpBadge({ value }: { value: string }) {
  return (
    <span
      className={cn("kelpie-badge", tlpColours[value] ?? "text-slate-300")}
      title="Traffic Light Protocol"
    >
      tlp:{value.replace("_", "+")}
    </span>
  );
}

export function AlertStatusBadge({ value }: { value: string }) {
  return (
    <span className={cn("kelpie-badge", alertStatusColours[value] ?? "text-slate-300")}>
      {value}
    </span>
  );
}

export function TaskStatusBadge({ value }: { value: string }) {
  return (
    <span className={cn("kelpie-badge", taskStatusColours[value] ?? "text-slate-300")}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function TagBadge({
  value,
  tone = "neutral",
}: {
  value: string;
  tone?: "neutral" | "classification";
}) {
  return (
    <span
      className={cn(
        "kelpie-badge normal-case tracking-normal",
        tone === "classification"
          ? "text-[color:var(--color-tan-300)]"
          : "text-slate-300",
      )}
    >
      {tone === "classification" ? `data:${value}` : value}
    </span>
  );
}
