/**
 * Small bundled D3FEND countermeasure reference list, offline by design (no
 * network access required). D3FEND mappings are optional and administrator
 * curated — Kelpie never infers a countermeasure link itself; this list only
 * gives the picker UI something to search against.
 */

export const D3FEND_CATALOG_VERSION = "d3fend-baseline-1.0-offline";

export type D3fendCatalogEntry = {
  id: string;
  name: string;
  /** ATT&CK techniques this countermeasure typically addresses (informational default only). */
  suggestedAttackTechniqueIds: string[];
};

export const D3FEND_CATALOG: D3fendCatalogEntry[] = [
  { id: "D3-NTA", name: "Network Traffic Analysis", suggestedAttackTechniqueIds: ["T1071", "T1105"] },
  { id: "D3-PM", name: "Platform Monitoring", suggestedAttackTechniqueIds: ["T1059", "T1053"] },
  { id: "D3-PA", name: "Process Analysis", suggestedAttackTechniqueIds: ["T1055", "T1059.001"] },
  { id: "D3-FE", name: "File Analysis", suggestedAttackTechniqueIds: ["T1027", "T1486"] },
  { id: "D3-CA", name: "Credential Hardening", suggestedAttackTechniqueIds: ["T1110", "T1003"] },
  { id: "D3-UAP", name: "User Account Permissions", suggestedAttackTechniqueIds: ["T1078", "T1098"] },
  { id: "D3-NI", name: "Network Isolation", suggestedAttackTechniqueIds: ["T1021", "T1021.001"] },
  { id: "D3-SWI", name: "Software Update", suggestedAttackTechniqueIds: ["T1190"] },
  { id: "D3-RA", name: "Restore Access", suggestedAttackTechniqueIds: ["T1490", "T1485"] },
  { id: "D3-SFA", name: "Sensitive Function Anomaly Detection", suggestedAttackTechniqueIds: ["T1548"] },
];

export function findD3fendEntry(id: string): D3fendCatalogEntry | undefined {
  return D3FEND_CATALOG.find((e) => e.id === id);
}
