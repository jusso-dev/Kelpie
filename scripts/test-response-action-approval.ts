import assert from "node:assert/strict";
import {
  RESPONSE_ACTION_APPROVAL_WINDOW_MS,
  responseActionApprovalExpiry,
} from "../src/lib/response-actions/core";
import { listActionHandlers } from "../src/lib/response-actions/registry";

const now = new Date("2026-07-27T00:00:00.000Z");
const expiry = responseActionApprovalExpiry(now);
assert.equal(
  expiry.getTime() - now.getTime(),
  RESPONSE_ACTION_APPROVAL_WINDOW_MS,
  "approval expiry must use the governed window",
);

const handlers = listActionHandlers();
assert.ok(handlers.length > 0, "response action handlers must be registered");
for (const handler of handlers) {
  assert.equal(handler.approvalRequired, true, `${handler.kind} must require approval`);
  assert.equal(typeof handler.target, "function", `${handler.kind} must expose exact target`);
}

const defender = handlers.find(
  (handler) => handler.kind === "defender_isolate_device",
);
assert.ok(defender, "Microsoft Defender isolation handler must be registered");
assert.equal(
  defender.validate({
    hostname: "host.contoso.local",
    machine_id: "a".repeat(40),
    isolation_type: "Selective",
    reason: "Confirmed ransomware execution on endpoint",
  }),
  null,
);
assert.equal(
  defender.target({
    hostname: "host.contoso.local",
    machine_id: "a".repeat(40),
  }),
  `host.contoso.local (${"a".repeat(40)})`,
);

console.log(`approval policy verified for ${handlers.length} response action handlers`);
