/**
 * Canonical MITRE ATT&CK Enterprise tactic list, used for tactic-based
 * filtering and coverage grouping. Tactic ids are the stable ATT&CK
 * shortnames (`TAxxxx`-free, matches the STIX `x_mitre_shortname` values)
 * rather than free text, so filtering is exact rather than string-matching a
 * display label.
 */

export type AttackTactic = { id: string; name: string };

export const ATTACK_TACTICS: AttackTactic[] = [
  { id: "reconnaissance", name: "Reconnaissance" },
  { id: "resource-development", name: "Resource Development" },
  { id: "initial-access", name: "Initial Access" },
  { id: "execution", name: "Execution" },
  { id: "persistence", name: "Persistence" },
  { id: "privilege-escalation", name: "Privilege Escalation" },
  { id: "defense-evasion", name: "Defense Evasion" },
  { id: "credential-access", name: "Credential Access" },
  { id: "discovery", name: "Discovery" },
  { id: "lateral-movement", name: "Lateral Movement" },
  { id: "collection", name: "Collection" },
  { id: "command-and-control", name: "Command and Control" },
  { id: "exfiltration", name: "Exfiltration" },
  { id: "impact", name: "Impact" },
];

export function findTactic(id: string): AttackTactic | undefined {
  return ATTACK_TACTICS.find((t) => t.id === id);
}

export function isKnownTactic(id: string): boolean {
  return ATTACK_TACTICS.some((t) => t.id === id);
}
