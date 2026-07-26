/**
 * Auth helper for legacy/manual cron endpoints. The bundled deployment uses
 * BullMQ; these routes remain for recovery and backwards compatibility.
 */
export function isAuthorisedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  return token === secret;
}
