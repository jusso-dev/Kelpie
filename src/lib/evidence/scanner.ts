export type ScanVerdict = "clean" | "malicious" | "error";

export type ScanOutcome = {
  verdict: ScanVerdict;
  engine: string;
  signature?: string;
  detail?: string;
};

/** Pluggable malware-scan backend. `scan` must never throw — return `error`. */
export interface EvidenceScanner {
  readonly name: string;
  scan(buffer: Buffer): Promise<ScanOutcome>;
}

/**
 * Secure default when no scanner backend is configured: evidence is left in
 * `scan_failed` rather than silently marked clean, so it stays behind the
 * admin-override gate until either a real scanner is configured or an admin
 * records a reasoned override.
 */
export class UnavailableScanner implements EvidenceScanner {
  readonly name = "unavailable";
  async scan(): Promise<ScanOutcome> {
    return {
      verdict: "error",
      engine: this.name,
      detail: "No malware scanner is configured for this deployment.",
    };
  }
}
