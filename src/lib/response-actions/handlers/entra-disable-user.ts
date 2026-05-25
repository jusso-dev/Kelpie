import type { ActionHandler, CaseObservable } from "../types";

function targetOptions(observables: CaseObservable[]) {
  return observables
    .filter((o) => o.type === "username" || o.type === "email")
    .map((o) => ({ value: o.value, label: `${o.value} (${o.type})` }));
}

async function getGraphToken(
  tenant: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15000),
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

export const entraDisableUser: ActionHandler = {
  kind: "entra_disable_user",
  label: "Disable user in Microsoft Entra",
  description:
    "Set accountEnabled=false for a compromised account via Microsoft Graph.",
  requiresObservableTypes: ["username", "email"],
  configFields: [
    { key: "tenant_id", label: "Tenant ID", type: "string", required: true },
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
        key: "user",
        label: "User to disable",
        type: "select",
        required: true,
        options: targetOptions(observables),
        help: "User principal name or object id.",
      },
    ];
  },
  validate(input) {
    if (!input.user?.trim()) return "A user is required";
    return null;
  },
  async execute(ctx) {
    const tenant = String(ctx.config.tenant_id ?? "").trim();
    const clientId = String(ctx.config.client_id ?? "").trim();
    const clientSecret = String(ctx.config.client_secret ?? "").trim();
    const user = ctx.input.user.trim();
    if (!tenant || !clientId || !clientSecret) {
      return { ok: false, summary: "Entra credentials are incomplete", error: "config" };
    }
    let token: string;
    try {
      token = await getGraphToken(tenant, clientId, clientSecret);
    } catch (e) {
      return {
        ok: false,
        target: user,
        summary: `Could not authenticate to Microsoft Graph: ${(e as Error).message}`,
        error: (e as Error).message,
      };
    }

    // Read previous state so the operator can manually re-enable later.
    let previousEnabled: boolean | null = null;
    const readRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}?$select=id,accountEnabled`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const readJson = (await readRes.json().catch(() => ({}))) as {
      id?: string;
      accountEnabled?: boolean;
      error?: { message?: string };
    };
    if (readRes.ok) previousEnabled = readJson.accountEnabled ?? null;

    const patchRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountEnabled: false }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!patchRes.ok) {
      const body = (await patchRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const msg = body.error?.message || `HTTP ${patchRes.status}`;
      return {
        ok: false,
        target: user,
        summary: `Graph rejected the disable for ${user}: ${msg}`,
        error: msg,
      };
    }
    return {
      ok: true,
      target: user,
      summary: `Disabled ${user} in Entra (previous accountEnabled=${previousEnabled})`,
      data: { userId: readJson.id ?? null, previousEnabled },
    };
  },
};
