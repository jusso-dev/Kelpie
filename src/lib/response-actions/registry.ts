import type { ActionHandler } from "./types";
import { cloudflareBlockIp } from "./handlers/cloudflare-block-ip";
import { entraDisableUser } from "./handlers/entra-disable-user";
import { crowdstrikeIsolateHost } from "./handlers/crowdstrike-isolate-host";

const HANDLERS: ActionHandler[] = [
  cloudflareBlockIp,
  entraDisableUser,
  crowdstrikeIsolateHost,
];

export function listActionHandlers(): ActionHandler[] {
  return HANDLERS;
}

export function getActionHandler(kind: string): ActionHandler | null {
  return HANDLERS.find((h) => h.kind === kind) ?? null;
}
