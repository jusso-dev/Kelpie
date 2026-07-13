export default function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-5" role="status" aria-live="polite">
      <span className="kelpie-sr-only">Loading workspace</span>
      <div className="space-y-3" aria-hidden="true">
        <div className="h-3 w-28 rounded bg-[color:var(--color-navy-700)]" />
        <div className="h-8 max-w-lg rounded bg-[color:var(--color-navy-800)]" />
        <div className="h-4 max-w-2xl rounded bg-[color:var(--color-navy-800)]" />
      </div>
      <div className="kelpie-panel grid gap-3 p-4 sm:grid-cols-3" aria-hidden="true">
        <div className="h-11 rounded bg-[color:var(--color-navy-800)]" />
        <div className="h-11 rounded bg-[color:var(--color-navy-800)]" />
        <div className="h-11 rounded bg-[color:var(--color-navy-800)]" />
      </div>
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="kelpie-card h-24" />
        ))}
      </div>
    </div>
  );
}
