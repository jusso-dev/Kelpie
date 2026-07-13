import MissingRecord from "@/components/missing-record";

export default function CaseNotFound() {
  return (
    <MissingRecord
      record="Case"
      description="This case may have been removed, or the link may belong to another workspace. No case data was changed."
      primaryHref="/cases"
      primaryLabel="Return to case queue"
    />
  );
}
