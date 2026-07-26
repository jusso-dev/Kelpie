import assert from "node:assert/strict";
import { readTeamTags } from "../src/lib/team-tags";

assert.deepEqual(
  readTeamTags({
    team_tags: {
      case_tags: [" Phishing ", "VIP Case", "phishing", "", 42],
      data_classification_tags: ["PII", "Customer_Data", "pii"],
    },
  }),
  {
    caseTags: ["phishing", "vip-case", "42"],
    dataClassificationTags: ["pii", "customer-data"],
  },
);

assert.deepEqual(readTeamTags(null), {
  caseTags: [],
  dataClassificationTags: [],
});

assert.deepEqual(
  readTeamTags({
    team_tags: {
      case_tags: "not-an-array",
      data_classification_tags: {},
    },
  }),
  {
    caseTags: [],
    dataClassificationTags: [],
  },
);

console.log("team tag tests passed");
