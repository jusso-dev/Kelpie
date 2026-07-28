"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { syncBaselineCatalogue } from "@/actions/playbooks";
import { feedbackError } from "@/components/confirm-dialog";

export default function SyncCatalogueButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function run() {
    setPending(true);
    try {
      const result = await syncBaselineCatalogue();
      const total = result.playbooksAdded + result.templatesAdded + result.templatesRelinked;
      if (total === 0) {
        toast.success("Catalogue already up to date", {
          description: "No new baseline playbooks or templates to add.",
        });
      } else {
        const relinked =
          result.templatesRelinked > 0
            ? ` Relinked ${result.templatesRelinked} template(s) to a recreated playbook.`
            : "";
        toast.success("Baseline catalogue synced", {
          description: `Added ${result.playbooksAdded} playbook(s) and ${result.templatesAdded} template(s). Existing playbooks were not changed.${relinked}`,
        });
      }
      router.refresh();
    } catch (error) {
      toast.error("Could not sync catalogue", {
        description: feedbackError(error, "Try again or check the server logs."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="kelpie-btn kelpie-btn-secondary"
      disabled={pending}
      onClick={() => void run()}
    >
      {pending ? "Syncing…" : "Sync baseline catalogue"}
    </button>
  );
}
