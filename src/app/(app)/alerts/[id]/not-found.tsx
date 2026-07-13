import MissingRecord from "@/components/missing-record";

export default function AlertNotFound() {
  return (
    <MissingRecord
      record="Alert"
      description="This alert may have been removed, promoted, or the link may belong to another workspace. No alert data was changed."
      primaryHref="/alerts"
      primaryLabel="Return to alert queue"
    />
  );
}
