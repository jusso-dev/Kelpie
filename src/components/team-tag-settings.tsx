"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveTeamTags } from "@/actions/team-tags";
import { feedbackError } from "@/components/confirm-dialog";
import CreatableTagInput from "@/components/creatable-tag-input";
import { parseTagsInput } from "@/lib/tags";

export default function TeamTagSettings({
  caseTags,
  dataClassificationTags,
}: {
  caseTags: string[];
  dataClassificationTags: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const formData = new FormData(event.currentTarget);
      await saveTeamTags({
        caseTags: parseTagsInput(String(formData.get("caseTags") ?? "")),
        dataClassificationTags: parseTagsInput(
          String(formData.get("dataClassificationTags") ?? ""),
        ),
      });
      toast.success("Team tags saved", {
        description: "Updated suggestions are available when cases are created.",
      });
      router.refresh();
    } catch (error) {
      toast.error("Team tags could not be saved", {
        description: feedbackError(
          error,
          "Existing team tags remain unchanged.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <CreatableTagInput
        name="caseTags"
        label="Case tags"
        suggestions={caseTags}
        initialTags={caseTags}
        help="Suggested operational labels, such as phishing, identity, ransomware, or vip."
      />
      <CreatableTagInput
        name="dataClassificationTags"
        label="Data classification tags"
        suggestions={dataClassificationTags}
        initialTags={dataClassificationTags}
        help="Suggested handling labels, such as pii, confidential, customer-data, or credentials."
      />
      <div className="flex justify-end">
        <button
          className="kelpie-btn kelpie-btn-primary"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save team tags"}
        </button>
      </div>
    </form>
  );
}
