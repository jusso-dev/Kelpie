import type { ActionHandler, CaseObservable } from "../types";
import { safeFetch } from "@/lib/outbound-request";

function targetOptions(observables: CaseObservable[]) {
  return observables
    .filter((o) => o.type === "hostname")
    .map((o) => ({ value: o.value, label: o.value }));
}

async function getFalconToken(
  base: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await safeFetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.errors?.map((e) => e.message).join("; ") || `token HTTP ${res.status}`,
    );
  }
  return json.access_token;
}

export const crowdstrikeIsolateHost: ActionHandler = {
  kind: "crowdstrike_isolate_host",
  label: "Isolate host in CrowdStrike",
  description:
    "Network-contain a host through CrowdStrike Falcon. Resolves the hostname to an agent id server-side.",
  requiresObservableTypes: ["hostname"],
  configFields: [
    {
      key: "base_url",
      label: "Falcon base URL",
      type: "string",
      required: true,
      placeholder: "https://api.crowdstrike.com",
    },
    { key: "client_id", label: "Client ID", type: "string", required: true },
    {
      key: "client_secret",
      label: "Client secret",
      type: "password",
      required: true,
    },
  ],
  inputFields(observables) {
    return [
      {
        key: "hostname",
        label: "Host to isolate",
        type: "select",
        required: true,
        options: targetOptions(observables),
      },
    ];
  },
  validate(input) {
    if (!input.hostname?.trim()) return "A hostname is required";
    return null;
  },
  async execute(ctx) {
    const base = String(ctx.config.base_url ?? "https://api.crowdstrike.com").replace(/\/$/, "");
    const clientId = String(ctx.config.client_id ?? "").trim();
    const clientSecret = String(ctx.config.client_secret ?? "").trim();
    const hostname = ctx.input.hostname.trim();
    if (!clientId || !clientSecret) {
      return { ok: false, summary: "CrowdStrike credentials are incomplete", error: "config" };
    }
    let token: string;
    try {
      token = await getFalconToken(base, clientId, clientSecret);
    } catch (e) {
      return {
        ok: false,
        target: hostname,
        summary: `Could not authenticate to Falcon: ${(e as Error).message}`,
        error: (e as Error).message,
      };
    }

    const filter = encodeURIComponent(`hostname:'${hostname}'`);
    const lookupRes = await safeFetch(
      `${base}/devices/queries/devices/v1?filter=${filter}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const lookupJson = (await lookupRes.json().catch(() => ({}))) as {
      resources?: string[];
    };
    const agentId = lookupJson.resources?.[0];
    if (!agentId) {
      return {
        ok: false,
        target: hostname,
        summary: `No Falcon agent found for ${hostname}`,
        error: "agent_not_found",
      };
    }

    const containRes = await safeFetch(
      `${base}/devices/entities/devices-actions/v2?action_name=contain`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: [agentId] }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!containRes.ok) {
      const body = (await containRes.json().catch(() => ({}))) as {
        errors?: Array<{ message?: string }>;
      };
      const msg = body.errors?.map((e) => e.message).join("; ") || `HTTP ${containRes.status}`;
      return {
        ok: false,
        target: hostname,
        summary: `Falcon rejected containment for ${hostname}: ${msg}`,
        error: msg,
        data: { agentId },
      };
    }
    return {
      ok: true,
      target: hostname,
      summary: `Isolated ${hostname} in CrowdStrike (agent ${agentId})`,
      data: { agentId, isolatedAt: new Date().toISOString() },
    };
  },
};
