import type { ActionHandler, CaseObservable } from "../types";

function targetOptions(observables: CaseObservable[]) {
  return observables
    .filter((o) => o.type === "ip")
    .map((o) => ({ value: o.value, label: o.value }));
}

export const cloudflareBlockIp: ActionHandler = {
  kind: "cloudflare_block_ip",
  label: "Block IP on Cloudflare",
  description:
    "Create a Cloudflare WAF block rule for an IP observable on the configured zone(s).",
  requiresObservableTypes: ["ip"],
  configFields: [
    {
      key: "api_token",
      label: "API token",
      type: "password",
      required: true,
      help: "Cloudflare token with Zone WAF edit permission.",
    },
    {
      key: "zone_ids",
      label: "Zone IDs",
      type: "string",
      required: true,
      placeholder: "comma separated zone ids",
    },
  ],
  inputFields(observables) {
    return [
      {
        key: "ip",
        label: "IP to block",
        type: "select",
        required: true,
        options: targetOptions(observables),
      },
      {
        key: "note",
        label: "Note",
        type: "string",
        required: false,
        placeholder: "Why is this being blocked?",
      },
    ];
  },
  validate(input) {
    const ip = input.ip?.trim();
    if (!ip) return "An IP is required";
    return null;
  },
  async execute(ctx) {
    const token = String(ctx.config.api_token ?? "").trim();
    const zones = String(ctx.config.zone_ids ?? "")
      .split(",")
      .map((z) => z.trim())
      .filter(Boolean);
    const ip = ctx.input.ip.trim();
    const note = ctx.input.note?.trim() || `Kelpie block ${ip}`;
    if (!token) return { ok: false, summary: "Missing Cloudflare API token", error: "config" };
    if (zones.length === 0) return { ok: false, summary: "No Cloudflare zones configured", error: "config" };

    const created: Array<{ zone: string; ruleId: string }> = [];
    for (const zone of zones) {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zone}/firewall/access_rules/rules`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "block",
            configuration: { target: "ip", value: ip },
            notes: note,
          }),
          signal: AbortSignal.timeout(15000),
        },
      ).catch((e) => {
        throw new Error(`Cloudflare request failed: ${(e as Error).message}`);
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        result?: { id?: string };
        errors?: Array<{ message?: string }>;
      };
      if (!res.ok || !json.success) {
        const msg =
          json.errors?.map((e) => e.message).join("; ") ||
          `HTTP ${res.status}`;
        return {
          ok: false,
          target: ip,
          summary: `Cloudflare rejected the block for ${ip}: ${msg}`,
          error: msg,
          data: { zone, response: json },
        };
      }
      created.push({ zone, ruleId: json.result?.id ?? "unknown" });
    }
    return {
      ok: true,
      target: ip,
      summary: `Blocked ${ip} on ${created.length} Cloudflare zone(s)`,
      data: { rules: created },
    };
  },
};
