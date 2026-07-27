import type { TiIndicatorType, TiSkipCounts } from "./indicator-types";

export type TiField = {
  key: string;
  label: string;
  type: "string" | "password";
  required: boolean;
  placeholder?: string;
  help?: string;
};

export type RawIndicator = {
  value: string;
  /** Always one of the four supported indicator types. */
  type: TiIndicatorType;
  confidence?: number;
  tags?: string[];
  attributes?: Record<string, unknown>;
};

/**
 * Handlers report both what they accepted and what they refused, so feed
 * health can show why records from an unsupported source were dropped.
 */
export type TiFeedFetchResult = {
  indicators: RawIndicator[];
  /** Skip tally keyed by rejected indicator type or skip reason. */
  skippedByType: TiSkipCounts;
};

export interface TiFeedHandler {
  kind: string;
  label: string;
  description: string;
  configFields: TiField[];
  fetchIndicators(ctx: {
    url: string | null;
    config: Record<string, unknown>;
  }): Promise<TiFeedFetchResult>;
}
