import type { EnrichmentProvider } from "../types";

export const urlParseProvider: EnrichmentProvider = {
  name: "url_parse",
  cacheTtlSeconds: 0,
  supports(type) {
    return type === "url";
  },
  async isConfigured() {
    return true;
  },
  async enrich({ value }) {
    try {
      const url = new URL(value);
      return {
        protocol: url.protocol,
        hostname: url.hostname,
        pathname: url.pathname,
        search: url.search,
      };
    } catch {
      return { error: "invalid_url" };
    }
  },
};
