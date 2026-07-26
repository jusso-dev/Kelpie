"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { watchVendor, unwatchVendor } from "@/actions/vendor-watchlist";
import {
  ConfirmActionButton,
  feedbackError,
} from "@/components/confirm-dialog";

export function WatchVendorButton({
  catalogSlug,
  vendorName,
}: {
  catalogSlug: string;
  vendorName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function add() {
    setPending(true);
    try {
      const result = await watchVendor(catalogSlug);
      toast.success(result.added ? "Vendor watch added" : "Already watching", {
        description: result.added
          ? `${result.name} reporting will now be highlighted in Cyber brief.`
          : `${result.name} is already on this organisation's watchlist.`,
      });
      router.refresh();
    } catch (error) {
      toast.error("Could not watch vendor", {
        description: feedbackError(
          error,
          `Kelpie could not add ${vendorName} to the watchlist.`,
        ),
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
      onClick={add}
    >
      <Eye size={16} aria-hidden="true" />
      {pending ? "Adding…" : "Watch vendor"}
    </button>
  );
}

export function UnwatchVendorButton({
  id,
  vendorName,
}: {
  id: string;
  vendorName: string;
}) {
  return (
    <ConfirmActionButton
      action={() => unwatchVendor(id)}
      title={`Stop watching ${vendorName}?`}
      description="Kelpie will stop highlighting new cyber reporting that matches this vendor. Existing cases and data are unchanged."
      confirmLabel="Stop watching"
      triggerLabel="Stop watching"
      successTitle="Vendor watch removed"
      successDescription={`${vendorName} will no longer be highlighted in Cyber brief.`}
      errorTitle="Could not remove vendor watch"
      className="kelpie-btn kelpie-btn-ghost text-red-300"
    />
  );
}
