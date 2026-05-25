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
  type: string;
  confidence?: number;
  tags?: string[];
  attributes?: Record<string, unknown>;
};

export interface TiFeedHandler {
  kind: string;
  label: string;
  description: string;
  configFields: TiField[];
  fetchIndicators(ctx: {
    url: string | null;
    config: Record<string, unknown>;
  }): Promise<RawIndicator[]>;
}
