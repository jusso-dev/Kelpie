"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

export default function CopyTextButton({
  text,
  label,
  className = "kelpie-btn kelpie-btn-secondary",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`, {
        description: "Copy it manually instead.",
      });
    }
  }

  return (
    <button type="button" className={className} onClick={() => void copy()}>
      <Copy className="h-4 w-4" aria-hidden />
      Copy {label}
    </button>
  );
}
