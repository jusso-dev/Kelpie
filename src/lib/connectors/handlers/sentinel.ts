import type { Connector } from "../types";

async function graphToken(
  tenant: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || `token HTTP ${res.status}`);
  }
  return json.access_token;
}

/**
 * Polls Microsoft Sentinel incidents through the Graph Security incidents API.
 * Cursor is the latest `lastUpdateDateTime` seen.
 */
export const sentinelConnector: Connector = {
  kind: "sentinel",
  label: "Microsoft Sentinel",
  description: "Poll Microsoft Sentinel incidents via the Graph Security API.",
  configFields: [
    { key: "tenant_id", label: "Tenant ID", type: "string", required: true },
    { key: "client_id", label: "Client ID", type: "string", required: true },
    {
      key: "client_secret",
      label: "Client secret",
      type: "password",
      required: true,
    },
    {
      key: "filter",
      label: "OData filter",
      type: "string",
      required: false,
      placeholder: "status eq 'active'",
    },
  ],
  defaultMapping: {
    title: "displayName",
    description: "description",
    severity: "severity",
    severityMap: {
      informational: "low",
      low: "low",
      medium: "medium",
      high: "high",
    },
    externalRef: "id",
    observables: [],
  },
  async poll({ config, cursor }) {
    const tenant = String(config.tenant_id ?? "");
    const clientId = String(config.client_id ?? "");
    const clientSecret = String(config.client_secret ?? "");
    const extraFilter = String(config.filter ?? "").trim();
    if (!tenant || !clientId || !clientSecret) {
      throw new Error("Sentinel connector is not fully configured");
    }
    const token = await graphToken(tenant, clientId, clientSecret);
    const since = cursor || new Date(Date.now() - 15 * 60000).toISOString();
    const filters = [`lastUpdateDateTime gt ${since}`];
    if (extraFilter) filters.push(`(${extraFilter})`);
    const url =
      `https://graph.microsoft.com/v1.0/security/incidents` +
      `?$filter=${encodeURIComponent(filters.join(" and "))}` +
      `&$top=100&$orderby=${encodeURIComponent("lastUpdateDateTime asc")}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`Sentinel HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      value?: Array<Record<string, unknown>>;
    };
    const records = json.value ?? [];
    let latest = cursor;
    for (const r of records) {
      const t = r.lastUpdateDateTime;
      if (typeof t === "string" && (!latest || t > latest)) latest = t;
    }
    return { records, nextCursor: latest };
  },
};
