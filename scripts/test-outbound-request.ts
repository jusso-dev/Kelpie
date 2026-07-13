import assert from "node:assert/strict";
import http from "node:http";
import {
  isPublicAddress,
  resolveOutboundTarget,
  safeFetch,
} from "../src/lib/outbound-request";

async function main() {
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, `${address} should be public`);
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} should be blocked`);
  }

  await assert.rejects(
    resolveOutboundTarget("file:///etc/passwd"),
    /HTTP or HTTPS/,
  );
  await assert.rejects(
    resolveOutboundTarget("https://user:pass@example.com"),
    /must not contain credentials/,
  );
  await assert.rejects(resolveOutboundTarget("http://[::1]"), /non-public/);
  await assert.rejects(
    resolveOutboundTarget("https://mixed.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /non-public/,
  );
  const publicTarget = await resolveOutboundTarget(
    "https://public.example/path",
    async () => [{ address: "8.8.8.8", family: 4 }],
  );
  assert.equal(publicTarget.url.hostname, "public.example");

  let redirectedTargetHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/redirected-target" });
      response.end();
      return;
    }
    if (request.url === "/redirected-target") redirectedTargetHits++;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("approved private integration");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const localUrl = `http://127.0.0.1:${address.port}`;
    await assert.rejects(safeFetch(localUrl), /non-public/);
    process.env.KELPIE_ALLOW_PRIVATE_NETWORKS = "true";
    const response = await safeFetch(localUrl);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "approved private integration");
    const redirect = await safeFetch(`${localUrl}/redirect`);
    assert.equal(redirect.status, 302);
    assert.equal(redirectedTargetHits, 0, "redirect destination must not be followed");
  } finally {
    delete process.env.KELPIE_ALLOW_PRIVATE_NETWORKS;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  console.log("Outbound URL policy blocks non-public IPv4 and IPv6 targets.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
