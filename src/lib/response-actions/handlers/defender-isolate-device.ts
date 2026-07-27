import { safeFetch } from "@/lib/outbound-request";
import type { ActionHandler, CaseObservable } from "../types";

const MACHINE_ID_PATTERN = /^[a-f0-9]{40}$/i;

function targetOptions(observables: CaseObservable[]) {
  return observables
    .filter((observable) => observable.type === "hostname")
    .map((observable) => ({
      value: observable.value,
      label: observable.value,
    }));
}

async function getDefenderToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
) {
  const response = await safeFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://api.security.microsoft.com/.default",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`Microsoft identity token request failed (${response.status})`);
  }
  return body.access_token;
}

function sameHostname(expected: string, actual: string) {
  const left = expected.trim().toLowerCase();
  const right = actual.trim().toLowerCase();
  return (
    left === right ||
    left.split(".")[0] === right.split(".")[0]
  );
}

export const defenderIsolateDevice: ActionHandler = {
  kind: "defender_isolate_device",
  label: "Isolate device in Microsoft Defender",
  description:
    "Verify a case hostname against an immutable Defender machine ID, then request network isolation.",
  approvalRequired: true,
  requiresObservableTypes: ["hostname"],
  configFields: [
    { key: "tenant_id", label: "Tenant ID", type: "string", required: true },
    { key: "client_id", label: "Client ID", type: "string", required: true },
    {
      key: "client_secret",
      label: "Client secret",
      type: "password",
      required: true,
      help: "App requires the least-privilege Machine.Isolate permission.",
    },
  ],
  inputFields(observables) {
    return [
      {
        key: "hostname",
        label: "Case hostname",
        type: "select",
        required: true,
        options: targetOptions(observables),
      },
      {
        key: "machine_id",
        label: "Defender machine ID",
        type: "string",
        required: true,
        help: "Immutable 40-character machine ID from Defender device evidence.",
      },
      {
        key: "isolation_type",
        label: "Isolation type",
        type: "select",
        required: true,
        options: [
          { value: "Selective", label: "Selective" },
          { value: "Full", label: "Full" },
        ],
      },
      {
        key: "reason",
        label: "Containment reason",
        type: "textarea",
        required: true,
        help: "Stored in Defender and Kelpie approval evidence.",
      },
    ];
  },
  target(input) {
    const hostname = input.hostname?.trim();
    const machineId = input.machine_id?.trim();
    return hostname && machineId ? `${hostname} (${machineId})` : null;
  },
  evidenceTarget(input) {
    return input.hostname?.trim() || null;
  },
  validate(input) {
    if (!input.hostname?.trim()) return "A case hostname is required";
    if (!MACHINE_ID_PATTERN.test(input.machine_id?.trim() ?? "")) {
      return "Defender machine ID must be 40 hexadecimal characters";
    }
    if (!["Selective", "Full"].includes(input.isolation_type)) {
      return "Choose Selective or Full isolation";
    }
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 10 || reason.length > 500) {
      return "Containment reason must be between 10 and 500 characters";
    }
    return null;
  },
  async execute(ctx) {
    const tenantId = String(ctx.config.tenant_id ?? "").trim();
    const clientId = String(ctx.config.client_id ?? "").trim();
    const clientSecret = String(ctx.config.client_secret ?? "").trim();
    const hostname = ctx.input.hostname.trim();
    const machineId = ctx.input.machine_id.trim();
    if (!tenantId || !clientId || !clientSecret) {
      return {
        ok: false,
        target: hostname,
        summary: "Microsoft Defender credentials are incomplete",
        error: "config",
      };
    }
    let token: string;
    try {
      token = await getDefenderToken(tenantId, clientId, clientSecret);
    } catch (error) {
      return {
        ok: false,
        target: hostname,
        summary: `Could not authenticate to Microsoft Defender: ${(error as Error).message}`,
        error: (error as Error).message,
      };
    }
    const machineResponse = await safeFetch(
      `https://api.security.microsoft.com/api/machines/${encodeURIComponent(machineId)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const machine = (await machineResponse.json().catch(() => ({}))) as {
      id?: string;
      computerDnsName?: string;
    };
    if (
      !machineResponse.ok ||
      machine.id !== machineId ||
      !machine.computerDnsName ||
      !sameHostname(hostname, machine.computerDnsName)
    ) {
      return {
        ok: false,
        target: hostname,
        summary: "Defender machine ID does not match the approved case hostname",
        error: "machine_identity_mismatch",
        data: { machineId },
      };
    }

    const response = await safeFetch(
      `https://api.security.microsoft.com/api/machines/${encodeURIComponent(machineId)}/isolate`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          Comment: `Kelpie ${ctx.caseId}: ${ctx.input.reason.trim()}`,
          IsolationType: ctx.input.isolation_type,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const action = (await response.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
    };
    if (!response.ok || !action.id) {
      return {
        ok: false,
        target: hostname,
        summary: `Microsoft Defender rejected isolation (${response.status})`,
        error: `HTTP ${response.status}`,
        data: { machineId },
      };
    }
    return {
      ok: true,
      target: hostname,
      summary: `Microsoft Defender accepted ${ctx.input.isolation_type.toLowerCase()} isolation for ${hostname}`,
      providerExternalId: action.id,
      data: {
        machineId,
        machineActionId: action.id,
        providerStatus: action.status ?? "Pending",
      },
    };
  },
};
