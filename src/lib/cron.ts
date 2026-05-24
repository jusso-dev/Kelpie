/**
 * Auth helper for internal cron endpoints. An external scheduler (cron,
 * docker-compose sidecar, k8s CronJob, GitHub Actions schedule) hits the
 * endpoint every minute with the shared secret.
 */
export function isAuthorisedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  return token === secret;
}
