export type EnrichmentResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
  cached?: boolean;
};

export type EnrichmentProvider = {
  name: string;
  /** Cache TTL in seconds; 0 means do not cache. */
  cacheTtlSeconds: number;
  supports(type: string): boolean;
  isConfigured(organisationId: string): Promise<boolean>;
  enrich(input: { type: string; value: string; organisationId: string }): Promise<Record<string, unknown>>;
};
