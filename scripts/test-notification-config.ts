import assert from "node:assert/strict";
import { resolveEmailProvider } from "../src/lib/email";
import { buildWebhookRequest, signPayload } from "../src/lib/webhooks";
import { STARTER_TI_FEEDS } from "../src/lib/ti/starter-feeds";

assert.equal(resolveEmailProvider({}), "console");
assert.equal(resolveEmailProvider({ RESEND_API_KEY: "test" }), "resend");
assert.equal(resolveEmailProvider({ EMAIL_PROVIDER: "ses" }), "ses");
assert.equal(resolveEmailProvider({ EMAIL_PROVIDER: "azure" }), "azure");

const generic = buildWebhookRequest({
  kind: "generic",
  event: "case.created",
  payload: { case_id: "case_1", title: "Test case" },
  secret: "secret",
  deliveryId: "delivery_1",
});
assert.equal(
  generic.headers["X-Kelpie-Signature"],
  signPayload(generic.body, "secret"),
);
assert.equal(generic.headers["X-Kelpie-Delivery"], "delivery_1");

process.env.APP_URL = "https://kepie.homelab";
const slack = JSON.parse(
  buildWebhookRequest({
    kind: "slack",
    event: "case.created",
    payload: { case_id: "case_1", case_number: "K-1", title: "Test case" },
    secret: "unused",
    deliveryId: "delivery_2",
  }).body,
) as { text: string; blocks: unknown[] };
assert.match(slack.text, /New Kelpie case/);
assert.ok(slack.blocks.length >= 2);

const teams = JSON.parse(
  buildWebhookRequest({
    kind: "teams",
    event: "alert.created",
    payload: { alert_id: "alert_1", title: "Test alert" },
    secret: "unused",
    deliveryId: "delivery_3",
  }).body,
) as { type: string; attachments: unknown[] };
assert.equal(teams.type, "message");
assert.equal(teams.attachments.length, 1);

assert.equal(STARTER_TI_FEEDS.length, 7);
assert.equal(
  STARTER_TI_FEEDS.filter((feed) => feed.isActive).length,
  4,
);
assert.equal(new Set(STARTER_TI_FEEDS.map((feed) => feed.url)).size, 7);

console.log("notification and starter-feed configuration tests passed");
