import type {
  AutomationCaseSnapshot,
  AutomationCondition,
} from "./types";

function valuesFor(
  snapshot: AutomationCaseSnapshot,
  field: AutomationCondition["field"],
): string[] {
  switch (field) {
    case "tag":
      return snapshot.tags;
    case "source_system":
      return snapshot.sourceSystem ? [snapshot.sourceSystem] : [];
    default:
      return [snapshot[field]];
  }
}

export function matchesAutomationConditions(
  snapshot: AutomationCaseSnapshot,
  conditions: AutomationCondition[],
): boolean {
  return conditions.every((condition) => {
    const expected = condition.value.trim().toLowerCase();
    if (!expected) return false;
    const values = valuesFor(snapshot, condition.field).map((value) =>
      value.toLowerCase(),
    );
    if (condition.operator === "not_equals") {
      return values.every((value) => value !== expected);
    }
    if (condition.operator === "contains") {
      return values.some((value) => value.includes(expected));
    }
    return values.some((value) => value === expected);
  });
}
