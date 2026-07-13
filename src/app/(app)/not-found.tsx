import MissingRecord from "@/components/missing-record";

export default function WorkspaceNotFound() {
  return (
    <MissingRecord
      record="Page"
      description="The address may be out of date or unavailable in this workspace."
      primaryHref="/dashboard"
      primaryLabel="Go to overview"
    />
  );
}
