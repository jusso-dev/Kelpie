import type { Connector } from "./types";
import { splunkConnector } from "./handlers/splunk";
import { elasticConnector } from "./handlers/elastic";
import { sentinelConnector } from "./handlers/sentinel";

const CONNECTORS: Connector[] = [
  splunkConnector,
  elasticConnector,
  sentinelConnector,
];

export function listConnectors(): Connector[] {
  return CONNECTORS;
}

export function getConnector(kind: string): Connector | null {
  return CONNECTORS.find((c) => c.kind === kind) ?? null;
}
