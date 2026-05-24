/**
 * Bundled, intentionally compact MITRE ATT&CK technique list for case tagging.
 * Phase 2 can replace this with a fuller dataset or a static refresh job.
 */

export type MitreTechnique = {
  id: string;
  name: string;
  tactic: string;
};

export const MITRE_TECHNIQUES: MitreTechnique[] = [
  { id: "T1566", name: "Phishing", tactic: "Initial Access" },
  { id: "T1566.001", name: "Spearphishing Attachment", tactic: "Initial Access" },
  { id: "T1566.002", name: "Spearphishing Link", tactic: "Initial Access" },
  { id: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access" },
  { id: "T1133", name: "External Remote Services", tactic: "Initial Access" },
  { id: "T1078", name: "Valid Accounts", tactic: "Initial Access" },
  { id: "T1059", name: "Command and Scripting Interpreter", tactic: "Execution" },
  { id: "T1059.001", name: "PowerShell", tactic: "Execution" },
  { id: "T1059.003", name: "Windows Command Shell", tactic: "Execution" },
  { id: "T1204", name: "User Execution", tactic: "Execution" },
  { id: "T1053", name: "Scheduled Task/Job", tactic: "Execution" },
  { id: "T1547", name: "Boot or Logon Autostart Execution", tactic: "Persistence" },
  { id: "T1136", name: "Create Account", tactic: "Persistence" },
  { id: "T1098", name: "Account Manipulation", tactic: "Persistence" },
  { id: "T1068", name: "Exploitation for Privilege Escalation", tactic: "Privilege Escalation" },
  { id: "T1548", name: "Abuse Elevation Control Mechanism", tactic: "Privilege Escalation" },
  { id: "T1027", name: "Obfuscated Files or Information", tactic: "Defense Evasion" },
  { id: "T1070", name: "Indicator Removal", tactic: "Defense Evasion" },
  { id: "T1562", name: "Impair Defenses", tactic: "Defense Evasion" },
  { id: "T1110", name: "Brute Force", tactic: "Credential Access" },
  { id: "T1555", name: "Credentials from Password Stores", tactic: "Credential Access" },
  { id: "T1003", name: "OS Credential Dumping", tactic: "Credential Access" },
  { id: "T1083", name: "File and Directory Discovery", tactic: "Discovery" },
  { id: "T1057", name: "Process Discovery", tactic: "Discovery" },
  { id: "T1018", name: "Remote System Discovery", tactic: "Discovery" },
  { id: "T1021", name: "Remote Services", tactic: "Lateral Movement" },
  { id: "T1021.001", name: "Remote Desktop Protocol", tactic: "Lateral Movement" },
  { id: "T1560", name: "Archive Collected Data", tactic: "Collection" },
  { id: "T1005", name: "Data from Local System", tactic: "Collection" },
  { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
  { id: "T1105", name: "Ingress Tool Transfer", tactic: "Command and Control" },
  { id: "T1041", name: "Exfiltration Over C2 Channel", tactic: "Exfiltration" },
  { id: "T1567", name: "Exfiltration Over Web Service", tactic: "Exfiltration" },
  { id: "T1486", name: "Data Encrypted for Impact", tactic: "Impact" },
  { id: "T1490", name: "Inhibit System Recovery", tactic: "Impact" },
  { id: "T1485", name: "Data Destruction", tactic: "Impact" },
];

export function findTechnique(id: string): MitreTechnique | undefined {
  return MITRE_TECHNIQUES.find((t) => t.id === id);
}
