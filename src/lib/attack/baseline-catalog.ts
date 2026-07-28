import type { CatalogSourceInput, RawAttackTechnique } from "./types";

/**
 * Bundled, offline ATT&CK Enterprise technique snapshot. This is the catalog
 * fresh installs and tests get with zero network access — imported
 * automatically the first time anything asks for the active catalog (see
 * `catalog-core.ts`'s `ensureCatalogInitialised`). An administrator can later
 * refresh from a configured URL; nothing in the app requires that to happen.
 *
 * `T1086` is included deliberately as an already-deprecated entry (its real
 * ATT&CK history: "PowerShell" was folded into `T1059.001` when Execution
 * techniques were restructured around the Command and Scripting Interpreter
 * technique), so the deprecation/carry-forward path has authentic data to
 * exercise from the very first import, not just after a refresh.
 */
export const BASELINE_CATALOG_VERSION = "attack-baseline-14.1-offline";

const tactic = (id: string, name: string) => ({ id, name });

const T = tactic;

export const BASELINE_TECHNIQUES: RawAttackTechnique[] = [
  { techniqueId: "T1566", name: "Phishing", tactics: [T("initial-access", "Initial Access")] },
  {
    techniqueId: "T1566.001",
    name: "Spearphishing Attachment",
    tactics: [T("initial-access", "Initial Access")],
    isSubtechnique: true,
    parentTechniqueId: "T1566",
  },
  {
    techniqueId: "T1566.002",
    name: "Spearphishing Link",
    tactics: [T("initial-access", "Initial Access")],
    isSubtechnique: true,
    parentTechniqueId: "T1566",
  },
  { techniqueId: "T1190", name: "Exploit Public-Facing Application", tactics: [T("initial-access", "Initial Access")] },
  { techniqueId: "T1133", name: "External Remote Services", tactics: [T("initial-access", "Initial Access"), T("persistence", "Persistence")] },
  { techniqueId: "T1078", name: "Valid Accounts", tactics: [T("initial-access", "Initial Access"), T("persistence", "Persistence"), T("privilege-escalation", "Privilege Escalation"), T("defense-evasion", "Defense Evasion")] },
  { techniqueId: "T1059", name: "Command and Scripting Interpreter", tactics: [T("execution", "Execution")] },
  {
    techniqueId: "T1059.001",
    name: "PowerShell",
    tactics: [T("execution", "Execution")],
    isSubtechnique: true,
    parentTechniqueId: "T1059",
  },
  {
    techniqueId: "T1059.003",
    name: "Windows Command Shell",
    tactics: [T("execution", "Execution")],
    isSubtechnique: true,
    parentTechniqueId: "T1059",
  },
  {
    techniqueId: "T1086",
    name: "PowerShell",
    tactics: [T("execution", "Execution")],
    deprecated: true,
    supersededByTechniqueId: "T1059.001",
    description:
      "Deprecated: folded into T1059.001 (Command and Scripting Interpreter: PowerShell).",
  },
  { techniqueId: "T1204", name: "User Execution", tactics: [T("execution", "Execution")] },
  { techniqueId: "T1053", name: "Scheduled Task/Job", tactics: [T("execution", "Execution"), T("persistence", "Persistence"), T("privilege-escalation", "Privilege Escalation")] },
  { techniqueId: "T1047", name: "Windows Management Instrumentation", tactics: [T("execution", "Execution")] },
  { techniqueId: "T1547", name: "Boot or Logon Autostart Execution", tactics: [T("persistence", "Persistence"), T("privilege-escalation", "Privilege Escalation")] },
  { techniqueId: "T1136", name: "Create Account", tactics: [T("persistence", "Persistence")] },
  { techniqueId: "T1098", name: "Account Manipulation", tactics: [T("persistence", "Persistence")] },
  { techniqueId: "T1068", name: "Exploitation for Privilege Escalation", tactics: [T("privilege-escalation", "Privilege Escalation")] },
  { techniqueId: "T1548", name: "Abuse Elevation Control Mechanism", tactics: [T("privilege-escalation", "Privilege Escalation"), T("defense-evasion", "Defense Evasion")] },
  { techniqueId: "T1027", name: "Obfuscated Files or Information", tactics: [T("defense-evasion", "Defense Evasion")] },
  { techniqueId: "T1070", name: "Indicator Removal", tactics: [T("defense-evasion", "Defense Evasion")] },
  { techniqueId: "T1562", name: "Impair Defenses", tactics: [T("defense-evasion", "Defense Evasion")] },
  { techniqueId: "T1036", name: "Masquerading", tactics: [T("defense-evasion", "Defense Evasion")] },
  { techniqueId: "T1110", name: "Brute Force", tactics: [T("credential-access", "Credential Access")] },
  { techniqueId: "T1555", name: "Credentials from Password Stores", tactics: [T("credential-access", "Credential Access")] },
  { techniqueId: "T1003", name: "OS Credential Dumping", tactics: [T("credential-access", "Credential Access")] },
  { techniqueId: "T1556", name: "Modify Authentication Process", tactics: [T("credential-access", "Credential Access"), T("defense-evasion", "Defense Evasion"), T("persistence", "Persistence")] },
  { techniqueId: "T1083", name: "File and Directory Discovery", tactics: [T("discovery", "Discovery")] },
  { techniqueId: "T1057", name: "Process Discovery", tactics: [T("discovery", "Discovery")] },
  { techniqueId: "T1018", name: "Remote System Discovery", tactics: [T("discovery", "Discovery")] },
  { techniqueId: "T1082", name: "System Information Discovery", tactics: [T("discovery", "Discovery")] },
  { techniqueId: "T1021", name: "Remote Services", tactics: [T("lateral-movement", "Lateral Movement")] },
  {
    techniqueId: "T1021.001",
    name: "Remote Desktop Protocol",
    tactics: [T("lateral-movement", "Lateral Movement")],
    isSubtechnique: true,
    parentTechniqueId: "T1021",
  },
  { techniqueId: "T1560", name: "Archive Collected Data", tactics: [T("collection", "Collection")] },
  { techniqueId: "T1005", name: "Data from Local System", tactics: [T("collection", "Collection")] },
  { techniqueId: "T1114", name: "Email Collection", tactics: [T("collection", "Collection")] },
  { techniqueId: "T1071", name: "Application Layer Protocol", tactics: [T("command-and-control", "Command and Control")] },
  { techniqueId: "T1105", name: "Ingress Tool Transfer", tactics: [T("command-and-control", "Command and Control")] },
  { techniqueId: "T1573", name: "Encrypted Channel", tactics: [T("command-and-control", "Command and Control")] },
  { techniqueId: "T1041", name: "Exfiltration Over C2 Channel", tactics: [T("exfiltration", "Exfiltration")] },
  { techniqueId: "T1567", name: "Exfiltration Over Web Service", tactics: [T("exfiltration", "Exfiltration")] },
  { techniqueId: "T1486", name: "Data Encrypted for Impact", tactics: [T("impact", "Impact")] },
  { techniqueId: "T1490", name: "Inhibit System Recovery", tactics: [T("impact", "Impact")] },
  { techniqueId: "T1485", name: "Data Destruction", tactics: [T("impact", "Impact")] },
  { techniqueId: "T1498", name: "Network Denial of Service", tactics: [T("impact", "Impact")] },
];

export function baselineCatalogSource(): CatalogSourceInput {
  return {
    version: BASELINE_CATALOG_VERSION,
    techniques: BASELINE_TECHNIQUES,
  };
}
