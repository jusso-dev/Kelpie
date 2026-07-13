import crypto from "node:crypto";
import http2 from "node:http2";
import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  mobileDevices,
  mobileNotificationDeliveries,
  users,
  type MobileDevice,
  type MobileNotificationDelivery,
} from "@/db/schema";
import { newId } from "@/lib/utils";

export type MobilePushEvent =
  | "critical_alert"
  | "sla_breach"
  | "comment_mention";

export type MobilePushInput = {
  event: MobilePushEvent;
  sourceId: string;
  title: string;
  body: string;
  destinationType: "alert" | "case";
  destinationId: string;
};

type ApnsConfiguration = {
  teamId: string;
  keyId: string;
  privateKey: string;
};

let cachedProviderToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function apnsConfiguration(): ApnsConfiguration | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey };
}

function providerToken(config: ApnsConfiguration): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedProviderToken && cachedProviderToken.expiresAt > now) {
    return cachedProviderToken.value;
  }
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = base64Url(JSON.stringify({ iss: config.teamId, iat: now }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(input), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const value = `${input}.${base64Url(signature)}`;
  cachedProviderToken = { value, expiresAt: now + 50 * 60 };
  return value;
}

async function sendToApns(
  delivery: MobileNotificationDelivery,
  device: MobileDevice,
  config: ApnsConfiguration,
): Promise<{ status: number; apnsId: string | null; reason: string | null }> {
  const origin =
    device.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  const client = http2.connect(origin);
  const payload = JSON.stringify({
    aps: {
      alert: { title: delivery.title, body: delivery.body },
      sound: "default",
      badge: 1,
      "thread-id": `${delivery.destinationType}:${delivery.destinationId}`,
      category:
        delivery.event === "critical_alert"
          ? "KELPIE_CRITICAL_ALERT"
          : "KELPIE_UPDATE",
    },
    event: delivery.event,
    destination_type: delivery.destinationType,
    destination_id: delivery.destinationId,
  });

  return new Promise((resolve, reject) => {
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${device.token}`,
      authorization: `bearer ${providerToken(config)}`,
      "apns-topic": device.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    const chunks: Buffer[] = [];
    let responseStatus = 0;
    let apnsId: string | null = null;
    const timeout = setTimeout(() => request.close(http2.constants.NGHTTP2_CANCEL), 10_000);

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      responseStatus = Number(headers[":status"] ?? 0);
      apnsId = typeof headers["apns-id"] === "string" ? headers["apns-id"] : null;
    });
    request.on("data", (chunk: string) => chunks.push(Buffer.from(chunk)));
    request.on("error", (error) => {
      clearTimeout(timeout);
      client.close();
      reject(error);
    });
    request.on("end", () => {
      clearTimeout(timeout);
      client.close();
      const responseBody = Buffer.concat(chunks).toString("utf8");
      let reason: string | null = null;
      if (responseBody) {
        try {
          reason = (JSON.parse(responseBody) as { reason?: string }).reason ?? responseBody;
        } catch {
          reason = responseBody;
        }
      }
      resolve({ status: responseStatus, apnsId, reason });
    });
    request.end(payload);
  });
}

export async function registerMobileDevice(input: {
  organisationId: string;
  userId: string;
  token: string;
  environment: "sandbox" | "production";
  bundleId: string;
}): Promise<{ id: string }> {
  const id = newId("device");
  const [device] = await db
    .insert(mobileDevices)
    .values({ id, ...input })
    .onConflictDoUpdate({
      target: [mobileDevices.token, mobileDevices.environment],
      set: {
        organisationId: input.organisationId,
        userId: input.userId,
        bundleId: input.bundleId,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: mobileDevices.id });
  return device;
}

export async function unregisterMobileDevice(input: {
  organisationId: string;
  userId: string;
  token: string;
}): Promise<void> {
  await db
    .update(mobileDevices)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(mobileDevices.organisationId, input.organisationId),
        eq(mobileDevices.userId, input.userId),
        eq(mobileDevices.token, input.token),
      ),
    );
}

export async function queueMobilePushForUsers(
  organisationId: string,
  userIds: string[],
  input: MobilePushInput,
): Promise<number> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return 0;
  const devices = await db
    .select()
    .from(mobileDevices)
    .where(
      and(
        eq(mobileDevices.organisationId, organisationId),
        eq(mobileDevices.isActive, true),
        inArray(mobileDevices.userId, recipients),
      ),
    );
  if (devices.length === 0) return 0;
  const inserted = await db
    .insert(mobileNotificationDeliveries)
    .values(
      devices.map((device) => ({
        id: newId("push"),
        deviceId: device.id,
        organisationId,
        userId: device.userId,
        event: input.event,
        dedupeKey: `${input.event}:${input.sourceId}:${device.id}`,
        title: input.title,
        body: input.body,
        destinationType: input.destinationType,
        destinationId: input.destinationId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: mobileNotificationDeliveries.id });
  return inserted.length;
}

export async function queueCriticalAlertPush(input: {
  organisationId: string;
  alertId: string;
}): Promise<number> {
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, input.organisationId),
        ne(users.role, "read_only"),
        eq(users.banned, false),
      ),
    );
  return queueMobilePushForUsers(
    input.organisationId,
    recipients.map((user) => user.id),
    {
      event: "critical_alert",
      sourceId: input.alertId,
      title: "Critical alert in Kelpie",
      body: "A new critical alert needs triage.",
      destinationType: "alert",
      destinationId: input.alertId,
    },
  );
}

export async function dispatchPendingMobilePushes(limit = 100): Promise<{
  configured: boolean;
  attempted: number;
  sent: number;
  failed: number;
}> {
  const config = apnsConfiguration();
  if (!config) return { configured: false, attempted: 0, sent: 0, failed: 0 };
  const pending = await db
    .select({ delivery: mobileNotificationDeliveries, device: mobileDevices })
    .from(mobileNotificationDeliveries)
    .innerJoin(mobileDevices, eq(mobileDevices.id, mobileNotificationDeliveries.deviceId))
    .where(
      and(
        eq(mobileNotificationDeliveries.status, "pending"),
        lte(mobileNotificationDeliveries.nextAttemptAt, new Date()),
        eq(mobileDevices.isActive, true),
      ),
    )
    .limit(Math.min(Math.max(limit, 1), 500));

  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      const response = await sendToApns(row.delivery, row.device, config);
      if (response.status === 200) {
        sent++;
        await db
          .update(mobileNotificationDeliveries)
          .set({
            status: "sent",
            attemptCount: row.delivery.attemptCount + 1,
            apnsId: response.apnsId,
            lastError: null,
            sentAt: new Date(),
          })
          .where(eq(mobileNotificationDeliveries.id, row.delivery.id));
        continue;
      }
      failed++;
      const terminal = response.status === 400 || response.status === 403;
      const gone = response.status === 410;
      if (gone) {
        await db
          .update(mobileDevices)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(mobileDevices.id, row.device.id));
      }
      const attempts = row.delivery.attemptCount + 1;
      await db
        .update(mobileNotificationDeliveries)
        .set({
          status: terminal || gone || attempts >= 5 ? "failed" : "pending",
          attemptCount: attempts,
          apnsId: response.apnsId,
          lastError: response.reason ?? `APNs HTTP ${response.status}`,
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 60 * 60_000)),
        })
        .where(eq(mobileNotificationDeliveries.id, row.delivery.id));
    } catch (error) {
      failed++;
      const attempts = row.delivery.attemptCount + 1;
      await db
        .update(mobileNotificationDeliveries)
        .set({
          status: attempts >= 5 ? "failed" : "pending",
          attemptCount: attempts,
          lastError: (error as Error).message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 60 * 60_000)),
        })
        .where(eq(mobileNotificationDeliveries.id, row.delivery.id));
    }
  }
  return { configured: true, attempted: pending.length, sent, failed };
}
