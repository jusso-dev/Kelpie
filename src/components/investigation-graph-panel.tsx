/**
 * Accessible textual investigation graph (issue #65). Full interactive
 * canvas can come later; this panel always ships a screen-reader-friendly
 * relationship list with provenance and confidence.
 */

import type {
  AttackStoryGraphEntry,
  GraphEdge,
  GraphNode,
  TacticLane,
} from "@/lib/investigations/graph-core";

export default function InvestigationGraphPanel({
  caseId,
  nodes,
  edges,
  story,
  tacticLanes,
  truncated,
}: {
  caseId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  story: AttackStoryGraphEntry[];
  tacticLanes: TacticLane[];
  truncated: boolean;
}) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
      aria-labelledby={`investigation-graph-${caseId}`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2
          id={`investigation-graph-${caseId}`}
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Investigation graph
        </h2>
        <p className="text-xs text-slate-500">
          {nodes.length} nodes · {edges.length} edges
          {truncated ? " · truncated" : ""}
        </p>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        Derived from stored alerts, entities, evidence, ATT&amp;CK mappings, and
        analyst-authored edges. Presentation does not invent relationships.
      </p>

      {edges.length === 0 ? (
        <p className="text-xs text-slate-500">
          No relationships on this case yet. Link alerts, entities, or evidence
          to populate the graph.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Relationship list">
          {edges.map((edge) => {
            const src = nodeById.get(edge.sourceNodeId);
            const tgt = nodeById.get(edge.targetNodeId);
            const conf =
              edge.confidence === null
                ? "unknown"
                : String(edge.confidence);
            return (
              <li
                key={edge.id}
                className="rounded border border-slate-100 px-2 py-1.5 text-xs dark:border-slate-800"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {src?.label ?? edge.sourceNodeId}
                </span>
                <span className="mx-1 text-slate-400">—[{edge.edgeType}]→</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {tgt?.label ?? edge.targetNodeId}
                </span>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  confidence {conf} · {edge.provenance} · {edge.source}
                  {edge.stored ? " · stored" : " · derived"}
                  {edge.observedAtStart
                    ? ` · observed ${edge.observedAtStart}${
                        edge.observedAtEnd ? ` → ${edge.observedAtEnd}` : ""
                      }`
                    : ""}
                </div>
                {edge.reason ? (
                  <div className="text-[11px] text-slate-500">
                    {edge.reason}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {story.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Attack story (sequence order)
          </h3>
          <ol className="space-y-1.5">
            {story.map((entry) => (
              <li
                key={entry.id}
                className="text-xs text-slate-700 dark:text-slate-200"
              >
                <span className="font-medium">
                  #{entry.sequenceIndex} {entry.title}
                </span>
                {entry.timingAmbiguous ? (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    (timing ambiguous)
                  </span>
                ) : null}
                <span className="ml-1 text-slate-400">
                  · {entry.provenance}
                  {entry.occurredAt ? ` · ${entry.occurredAt}` : ""}
                </span>
                {entry.timingNote ? (
                  <div className="text-[11px] text-slate-500">
                    {entry.timingNote}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {tacticLanes.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            ATT&amp;CK tactic lanes
          </h3>
          <ul className="space-y-2">
            {tacticLanes.map((lane) => (
              <li key={lane.tacticId}>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {lane.tacticName}
                </div>
                <ul className="ml-3 list-disc text-[11px] text-slate-500">
                  {lane.techniques.map((t) => (
                    <li key={t.techniqueId}>
                      {t.techniqueId}
                      {t.techniqueName ? ` — ${t.techniqueName}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
