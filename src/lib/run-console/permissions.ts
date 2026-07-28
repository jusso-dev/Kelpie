import type { CurrentUser } from "@/lib/session";

/**
 * Observation and control are granted separately (issue #67). Every signed-in
 * organisation member, including `read_only`, can observe the run console:
 * visibility into what automation/response-action work happened is safe by
 * itself. Retrying or cancelling a run requires the same roles that can
 * request a response action (`admin`/`analyst`). Kill switches are the most
 * consequential control available here, so only `admin` may flip one.
 */
export function canObserveRunConsole(user: CurrentUser): boolean {
  return user.role === "admin" || user.role === "analyst" || user.role === "read_only";
}

export function canControlRuns(user: CurrentUser): boolean {
  return user.role === "admin" || user.role === "analyst";
}

export function canManageKillSwitches(user: CurrentUser): boolean {
  return user.role === "admin";
}
