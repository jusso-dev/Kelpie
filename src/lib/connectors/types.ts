export type ConnectorField = {
  key: string;
  label: string;
  type: "string" | "password" | "number";
  required: boolean;
  placeholder?: string;
  help?: string;
};

/**
 * A single JSON document describing how a vendor record maps onto a Kelpie
 * alert. Field references are dot-paths into the vendor record.
 */
export type FieldMapping = {
  title: string;
  description?: string;
  severity?: string;
  /** Maps a raw severity value to a Kelpie severity. */
  severityMap?: Record<string, "low" | "medium" | "high" | "critical">;
  defaultSeverity?: "low" | "medium" | "high" | "critical";
  /** Dot-path that uniquely identifies the record, used for dedupe. */
  externalRef: string;
  observables?: Array<{ type: string; path: string }>;
};

export type NormalisedAlert = {
  title: string;
  description: string | null;
  severity: "low" | "medium" | "high" | "critical";
  externalRef: string | null;
  observables: Array<{ type: string; value: string }>;
  rawPayload: Record<string, unknown>;
};

export type PollResult = {
  records: Array<Record<string, unknown>>;
  nextCursor: string | null;
};

export interface Connector {
  kind: string;
  label: string;
  description: string;
  configFields: ConnectorField[];
  defaultMapping: FieldMapping;
  poll(ctx: {
    config: Record<string, unknown>;
    cursor: string | null;
  }): Promise<PollResult>;
}
