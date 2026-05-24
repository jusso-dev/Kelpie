import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import { findTechnique } from "@/data/mitre";
import type { CaseReportData } from "./report";
import { renderTlpBanner } from "./report";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    padding: 36,
    backgroundColor: "#ffffff",
    color: "#0a0f1d",
  },
  banner: {
    backgroundColor: "#7c2d12",
    color: "#ffffff",
    padding: 6,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
  },
  bannerAmber: {
    backgroundColor: "#92400e",
    color: "#ffffff",
    padding: 6,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
  },
  header: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  caseNumber: {
    fontFamily: "Helvetica-Bold",
    color: "#475569",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  metaChip: {
    backgroundColor: "#e2e8f0",
    padding: "2 6",
    borderRadius: 3,
  },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 2,
  },
  para: {
    marginBottom: 4,
    lineHeight: 1.4,
  },
  bullet: {
    flexDirection: "row",
    marginBottom: 2,
  },
  bulletDot: {
    width: 8,
  },
  bulletText: {
    flex: 1,
  },
  timelineRow: {
    flexDirection: "row",
    marginBottom: 2,
    fontSize: 8,
  },
  timestamp: {
    width: 120,
    color: "#64748b",
  },
  eventType: {
    width: 100,
    fontFamily: "Helvetica-Bold",
  },
  ioc: {
    fontFamily: "Helvetica-Bold",
    color: "#b45309",
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#94a3b8",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function summarisePayload(eventType: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  switch (eventType) {
    case "status_change":
      return `${p.from ?? "?"} → ${p.to ?? "?"}${p.reason ? ` (${p.reason})` : ""}`;
    case "severity_change":
      return `${p.from ?? "?"} → ${p.to ?? "?"}`;
    case "task_created":
    case "task_completed":
    case "task_updated":
      return String(p.title ?? "");
    case "observable_added":
      return `${p.type ?? ""}: ${p.value ?? ""}`;
    case "playbook_started":
      return `${p.playbook_name ?? ""} (${p.steps ?? 0} steps)`;
    case "comment":
      return String(p.preview ?? "");
    case "sla_breach":
      return `gate=${p.gate} +${p.minutes_over}m`;
    default:
      return JSON.stringify(p).slice(0, 200);
  }
}

function CaseReport({ data }: { data: CaseReportData }) {
  const c = data.case;
  const banner = renderTlpBanner(c.tlp);
  const bannerStyle = c.tlp === "red" ? styles.banner : styles.bannerAmber;
  const techniques = (c.mitreTechniques as string[]) ?? [];

  return (
    <Document
      title={`${c.caseNumber} ${c.title}`}
      author="Kelpie"
      subject={`Kelpie case ${c.caseNumber}`}
    >
      <Page size="A4" style={styles.page}>
        {banner ? (
          <View style={bannerStyle} fixed>
            <Text>{banner}</Text>
          </View>
        ) : null}
        <Text style={styles.header}>
          <Text style={styles.caseNumber}>{c.caseNumber} </Text>
          {c.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaChip}>status: {c.status.replace(/_/g, " ")}</Text>
          <Text style={styles.metaChip}>severity: {c.severity}</Text>
          <Text style={styles.metaChip}>tlp:{c.tlp.replace("_", "+")}</Text>
          <Text style={styles.metaChip}>pap:{c.pap}</Text>
          <Text style={styles.metaChip}>
            {c.classification.replace(/_/g, " ")}
          </Text>
        </View>
        <View>
          {data.assignee ? (
            <Text style={styles.para}>Assignee: {data.assignee.name} ({data.assignee.email})</Text>
          ) : null}
          {data.reporter ? (
            <Text style={styles.para}>Reporter: {data.reporter.name} ({data.reporter.email})</Text>
          ) : null}
          <Text style={styles.para}>Opened: {c.openedAt.toISOString()}</Text>
          {c.acknowledgedAt ? <Text style={styles.para}>Acknowledged: {c.acknowledgedAt.toISOString()}</Text> : null}
          {c.containedAt ? <Text style={styles.para}>Contained: {c.containedAt.toISOString()}</Text> : null}
          {c.resolvedAt ? <Text style={styles.para}>Resolved: {c.resolvedAt.toISOString()}</Text> : null}
          {c.closedAt ? <Text style={styles.para}>Closed: {c.closedAt.toISOString()}</Text> : null}
        </View>

        {c.summary ? (
          <>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.para}>{c.summary}</Text>
          </>
        ) : null}

        {techniques.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>MITRE ATT&CK</Text>
            {techniques.map((id) => {
              const t = findTechnique(id);
              return (
                <View key={id} style={styles.bullet}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>
                    {id}
                    {t ? ` — ${t.name} (${t.tactic})` : ""}
                  </Text>
                </View>
              );
            })}
          </>
        ) : null}

        {data.observables.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Observables</Text>
            {data.observables.map((o) => (
              <View key={o.id} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>
                  <Text>{o.type}: </Text>
                  <Text>{o.value} </Text>
                  <Text>(tlp:{o.tlp})</Text>
                  {o.isIoc ? <Text style={styles.ioc}> IOC</Text> : null}
                  {o.description ? <Text> — {o.description}</Text> : null}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {data.tasks.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Tasks</Text>
            {data.tasks.map((t) => (
              <View key={t.id} style={styles.bullet}>
                <Text style={styles.bulletDot}>{t.status === "done" ? "✓" : "○"}</Text>
                <Text style={styles.bulletText}>
                  {t.title}
                  {t.dueAt ? ` (due ${t.dueAt.toISOString()})` : ""}
                  {t.completedAt ? ` — done ${t.completedAt.toISOString()}` : ""}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {data.timeline.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Timeline</Text>
            {data.timeline.map((e, i) => (
              <View key={i} style={styles.timelineRow}>
                <Text style={styles.timestamp}>{e.occurredAt.toISOString()}</Text>
                <Text style={styles.eventType}>{e.eventType}</Text>
                <Text style={{ flex: 1 }}>
                  {e.actorName ?? "system"} — {summarisePayload(e.eventType, e.payload)}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {c.status === "closed" ? (
          <>
            <Text style={styles.sectionTitle}>Closure</Text>
            {c.closureReason ? (
              <Text style={styles.para}>Reason: {c.closureReason}</Text>
            ) : null}
            {c.closureSummary ? (
              <Text style={styles.para}>{c.closureSummary}</Text>
            ) : null}
          </>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>{c.caseNumber} — Kelpie</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCasePdf(data: CaseReportData): Promise<Buffer> {
  return renderToBuffer(<CaseReport data={data} />);
}
