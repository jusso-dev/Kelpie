import assert from "node:assert/strict";
import { VENDOR_CATALOG } from "../src/data/vendor-catalog";
import { matchingVendors, type WatchedVendor } from "../src/lib/vendor-news";

const watched: WatchedVendor[] = [
  {
    id: "vnd_slack",
    catalogSlug: "slack",
    displayName: "Slack",
    website: "https://slack.com",
    category: "Productivity",
    aliases: ["slack"],
  },
  {
    id: "vnd_box",
    catalogSlug: "box",
    displayName: "Box",
    website: "https://box.com",
    category: "Storage",
    aliases: ["box"],
  },
];

assert.equal(VENDOR_CATALOG.length, 606);
assert.equal(new Set(VENDOR_CATALOG.map((vendor) => vendor.slug)).size, 606);

assert.deepEqual(
  matchingVendors(
    {
      title: "Slack publishes security update",
      summary: "Administrators should review the vendor guidance.",
    },
    watched,
  ).map((vendor) => vendor.catalogSlug),
  ["slack"],
);

assert.deepEqual(
  matchingVendors(
    {
      title: "New sandbox escape research",
      summary: "The technique affects an unrelated runtime.",
    },
    watched,
  ),
  [],
);

console.log("vendor news matching passed");
