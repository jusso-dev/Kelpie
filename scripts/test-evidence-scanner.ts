/**
 * Coverage for the ClamAV clamd INSTREAM client (issue #44) against a mock
 * clamd TCP server, exercising clean/malicious/protocol-error responses.
 * Also verifies the full pending_scan -> quarantined pipeline end to end
 * against a real Postgres instance, and that a malicious verdict quarantines
 * without ever marking evidence available.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  attachments,
  cases,
  evidenceCustodyEvents,
  organisations,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import { ClamAvScanner } from "../src/lib/evidence/clamav-scanner";
import { uploadEvidenceCore, EvidenceError, downloadEvidenceCore } from "../src/lib/evidence/core";
import { scanPendingEvidence } from "../src/lib/evidence/scan-runner";

type MockResponder = (received: Buffer) => string;

function startMockClamd(respond: MockResponder): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => {
        socket.end(Buffer.from(respond(Buffer.concat(chunks)) + "\0"));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

async function testClamAvClient() {
  const clean = await startMockClamd(() => "stream: OK");
  const cleanResult = await new ClamAvScanner("127.0.0.1", clean.port).scan(Buffer.from("hello"));
  assert.equal(cleanResult.verdict, "clean");
  await clean.close();

  const malicious = await startMockClamd(() => "stream: Eicar-Test-Signature FOUND");
  const maliciousResult = await new ClamAvScanner("127.0.0.1", malicious.port).scan(Buffer.from("hello"));
  assert.equal(maliciousResult.verdict, "malicious");
  assert.equal(maliciousResult.signature, "Eicar-Test-Signature");
  await malicious.close();

  const garbled = await startMockClamd(() => "not a real clamd response");
  const garbledResult = await new ClamAvScanner("127.0.0.1", garbled.port).scan(Buffer.from("hello"));
  assert.equal(garbledResult.verdict, "error");
  await garbled.close();

  const unreachablePort = 1; // reserved; connection refused
  const unreachableResult = await new ClamAvScanner("127.0.0.1", unreachablePort, 2_000).scan(
    Buffer.from("hello"),
  );
  assert.equal(unreachableResult.verdict, "error");

  console.log("ok: ClamAV INSTREAM client parses clean/malicious/garbled/unreachable responses");
}

const runId = newId("evscan").slice("evscan_".length).slice(0, 10);
const orgId = `org_evscan_${runId}`;
const userId = `user_evscan_${runId}`;

async function testQuarantinePipeline() {
  await db.insert(organisations).values({ id: orgId, name: "Evidence Scanner Test Org", slug: `evscan-${runId}` });
  await db.insert(users).values({
    id: userId,
    name: "Scanner Tester",
    email: `evscan-${runId}@example.com`,
    organisationId: orgId,
    role: "admin",
  });
  const caseId = newId("case");
  await db.insert(cases).values({
    id: caseId,
    organisationId: orgId,
    caseNumber: `EVSCAN-${runId}`,
    title: "Evidence scanner fixture case",
  });

  const clean = await startMockClamd(() => "stream: OK");
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(clean.port);
  const cleanUpload = await uploadEvidenceCore({
    organisationId: orgId,
    caseId,
    actorId: userId,
    buffer: Buffer.from("harmless report content"),
    filename: "report.txt",
    declaredContentType: null,
  });
  const cleanResult = await scanPendingEvidence(10);
  assert.ok(cleanResult.scanned >= 1);
  const [cleanRow] = await db.select().from(attachments).where(eq(attachments.id, cleanUpload.id)).limit(1);
  assert.equal(cleanRow?.status, "available");
  assert.equal(cleanRow?.scanVerdict, "clean");
  const cleanDownload = await downloadEvidenceCore(cleanUpload.id, orgId, userId);
  assert.ok(cleanDownload.buffer.equals(Buffer.from("harmless report content")));
  await clean.close();
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
  console.log("ok: clean scan verdict marks evidence available and downloadable end to end");

  const malicious = await startMockClamd(() => "stream: Eicar-Test-Signature FOUND");
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(malicious.port);
  try {
    const uploaded = await uploadEvidenceCore({
      organisationId: orgId,
      caseId,
      actorId: userId,
      buffer: Buffer.from("simulated malicious payload"),
      filename: "invoice.exe",
      declaredContentType: null,
    });
    const result = await scanPendingEvidence(10);
    assert.ok(result.quarantined >= 1);

    const [row] = await db.select().from(attachments).where(eq(attachments.id, uploaded.id)).limit(1);
    assert.equal(row?.status, "quarantined");
    assert.equal(row?.scanVerdict, "malicious");

    await assert.rejects(
      () => downloadEvidenceCore(uploaded.id, orgId, userId),
      (err: unknown) => err instanceof EvidenceError && err.status === 423,
    );
    console.log("ok: malicious scan verdict quarantines evidence and blocks download");
  } finally {
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
    await malicious.close();
    await db.delete(evidenceCustodyEvents).where(eq(evidenceCustodyEvents.organisationId, orgId));
    await db.delete(attachments).where(eq(attachments.caseId, caseId));
    await db.delete(cases).where(eq(cases.id, caseId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(organisations).where(eq(organisations.id, orgId));
  }
}

async function main() {
  await testClamAvClient();
  await testQuarantinePipeline();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
