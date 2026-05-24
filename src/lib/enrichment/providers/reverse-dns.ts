import dns from "node:dns/promises";
import type { EnrichmentProvider } from "../types";

export const reverseDnsProvider: EnrichmentProvider = {
  name: "reverse_dns",
  cacheTtlSeconds: 60 * 60,
  supports(type) {
    return type === "ip";
  },
  async isConfigured() {
    return true;
  },
  async enrich({ value }) {
    try {
      const hostnames = await dns.reverse(value);
      return { hostnames };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
};
