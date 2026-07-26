export const WEBHOOK_EVENTS = [
  "case.created",
  "case.status_changed",
  "case.closed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
