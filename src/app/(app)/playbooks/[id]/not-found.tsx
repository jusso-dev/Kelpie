import MissingRecord from "@/components/missing-record";

export default function PlaybookNotFound() {
  return (
    <MissingRecord
      record="Playbook"
      description="This playbook may have been removed, or the link may belong to another workspace. Existing case tasks were not affected."
      primaryHref="/playbooks"
      primaryLabel="Return to playbooks"
    />
  );
}
