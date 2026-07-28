/**
 * Unit coverage for mailbox intake helpers (issue #42):
 * credential crypto, HTML sanitisation, RFC822 parse, idempotency helpers,
 * Graph message mapping.
 */
import assert from "node:assert/strict";
import {
  decryptCredentials,
  encryptCredentials,
} from "../src/lib/mailbox/crypto";
import {
  htmlToPlainText,
  sanitizeEmailHtml,
  truncateBody,
} from "../src/lib/mailbox/sanitize";
import {
  decodeMimeWord,
  parseAddressList,
  parseRfc822,
  buildEmlFromParts,
} from "../src/lib/mailbox/parse";
import { mapGraphMessageForTest } from "../src/lib/mailbox/graph";
import { mailboxSourceSystem } from "../src/lib/mailbox/types";

// Stable test key: 32 zero bytes as hex.
process.env.CREDENTIALS_ENCRYPTION_KEY =
  process.env.CREDENTIALS_ENCRYPTION_KEY ??
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function testCrypto() {
  const sealed = encryptCredentials({ password: "s3cret-value" });
  assert.match(sealed, /^v1:/);
  assert.doesNotMatch(sealed, /s3cret-value/);
  const opened = decryptCredentials(sealed);
  assert.equal(opened.password, "s3cret-value");

  const a = encryptCredentials({ client_secret: "abc" });
  const b = encryptCredentials({ client_secret: "abc" });
  // Random IV → different ciphertexts for same plaintext.
  assert.notEqual(a, b);
  assert.equal(decryptCredentials(a).client_secret, "abc");
  assert.equal(decryptCredentials(b).client_secret, "abc");

  assert.throws(() => decryptCredentials("not-a-blob"), /Unsupported|Malformed|credential/i);
  console.log("ok: credential crypto");
}

function testSanitize() {
  const dirty = `
    <html><body>
      <script>alert('xss')</script>
      <img src=x onerror="alert(1)">
      <img/src=x onerror=alert(1)>
      <script/src=//evil.example></script>
      <a href="javascript:alert(1)">bad</a>
      <a href="https://example.com/report">ok</a>
      <p onclick="evil()">Hello <strong>world</strong></p>
      <style>body{display:none}</style>
    </body></html>
  `;
  const clean = sanitizeEmailHtml(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /<style/i);
  assert.doesNotMatch(clean, /<img/i);
  assert.doesNotMatch(clean, /evil\.example/i);
  assert.match(clean, /https:\/\/example\.com\/report/);
  assert.match(clean, /<strong>world<\/strong>/);

  const plain = htmlToPlainText("<p>Hi<br>there</p>");
  assert.match(plain, /Hi/);
  assert.match(plain, /there/);

  const long = "x".repeat(250_000);
  assert.ok(truncateBody(long).endsWith("[truncated]"));
  console.log("ok: html sanitisation");
}

function testParse() {
  assert.equal(decodeMimeWord("=?UTF-8?B?SGVsbG8=?="), "Hello");
  const addrs = parseAddressList(
    `"Alice Example" <alice@example.com>, bob@example.org`,
  );
  assert.equal(addrs.length, 2);
  assert.equal(addrs[0].address, "alice@example.com");
  assert.equal(addrs[0].name, "Alice Example");
  assert.equal(addrs[1].address, "bob@example.org");

  const boundary = "----=_Part_42";
  const raw = Buffer.from(
    [
      "Message-ID: <msg-unit-1@example.com>",
      "Date: Mon, 28 Jul 2026 12:00:00 +0000",
      "From: Reporter <reporter@example.com>",
      "To: soc@example.com",
      "Subject: Phishing report",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Please investigate this message.",
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "",
      '<p>Please investigate <a href="https://safe.example">link</a><script>evil()</script></p>',
      `--${boundary}`,
      "Content-Type: application/octet-stream; name=note.txt",
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="note.txt"',
      "",
      Buffer.from("attachment-bytes").toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    "utf8",
  );

  const parsed = parseRfc822(raw);
  assert.equal(parsed.providerMessageId, "msg-unit-1@example.com");
  assert.equal(parsed.from?.address, "reporter@example.com");
  assert.equal(parsed.subject, "Phishing report");
  assert.match(parsed.bodyText, /Please investigate this message/);
  assert.doesNotMatch(parsed.bodyHtmlSanitized, /<script/i);
  assert.match(parsed.bodyHtmlSanitized, /https:\/\/safe\.example/);
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].filename, "note.txt");
  assert.equal(
    parsed.attachments[0].content?.toString("utf8"),
    "attachment-bytes",
  );

  // Malformed: missing headers still yields a message.
  const bare = parseRfc822(Buffer.from("not really email", "utf8"));
  assert.ok(bare.subject);

  const eml = buildEmlFromParts({
    messageId: "graph-1",
    subject: "Hi",
    from: "a@b.com",
    to: ["c@d.com"],
    cc: [],
    date: new Date("2026-07-28T00:00:00Z"),
    bodyText: "body",
  });
  assert.match(eml.toString("utf8"), /Message-ID: <graph-1>/);
  console.log("ok: rfc822 parse");
}

function testGraphMap() {
  const mapped = mapGraphMessageForTest({
    id: "AAMkAGI",
    internetMessageId: "<graph-msg@contoso.com>",
    subject: "BEC attempt",
    body: {
      contentType: "html",
      content: '<p>Wire funds</p><script>alert(1)</script>',
    },
    from: { emailAddress: { name: "CFO", address: "cfo@contoso.com" } },
    toRecipients: [
      { emailAddress: { address: "finance@contoso.com" } },
    ],
    receivedDateTime: "2026-07-28T10:00:00Z",
  });
  assert.equal(mapped.providerMessageId, "graph-msg@contoso.com");
  assert.equal(mapped.from?.address, "cfo@contoso.com");
  assert.doesNotMatch(mapped.bodyHtmlSanitized, /script/i);
  assert.match(mapped.bodyText, /Wire funds/);
  console.log("ok: graph map");
}

function testSourceSystem() {
  assert.equal(mailboxSourceSystem("mbox_abc"), "mailbox:mbox_abc");
  console.log("ok: source system helper");
}

function main() {
  testCrypto();
  testSanitize();
  testParse();
  testGraphMap();
  testSourceSystem();
  console.log("mailbox core unit tests passed");
}

main();
