"use client";

import { useState } from "react";
import { startPlaybookOnCase } from "@/actions/playbooks";
import { useRouter } from "next/navigation";

export default function PlaybookStarter({
  caseId,
  playbooks,
}: {
  caseId: string;
  playbooks: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState(playbooks[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <form
      action={async (fd) => {
        fd.set("caseId", caseId);
        fd.set("playbookId", selected);
        setPending(true);
        await startPlaybookOnCase(fd);
        setPending(false);
        router.refresh();
      }}
      className="space-y-2"
    >
      <select
        className="kelpie-input"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {playbooks.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="kelpie-btn kelpie-btn-secondary w-full justify-center"
        disabled={pending || !selected}
      >
        {pending ? "Starting..." : "Start playbook"}
      </button>
    </form>
  );
}
