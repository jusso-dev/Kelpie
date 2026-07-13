import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { newId } from "../src/lib/utils";

function sessionHeaders(setCookie: string): Headers {
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  assert.ok(match, "sign-in response must set a session token");
  return new Headers({ Cookie: `better-auth.session_token=${match[1]}` });
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    assert.notEqual(index, -1, "TOTP secret must use base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string): string {
  const counter = Math.floor(Date.now() / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = crypto
    .createHmac("sha1", decodeBase32(secret))
    .update(counterBytes)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, "0");
}

async function main() {
  const email = `${newId("auth-test")}@example.test`;
  const password = "Kelpie-auth-test-9";
  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: "Authentication test" },
  });

  try {
    const signIn = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    assert.equal(signIn.response?.user.email, email);
    const headers = sessionHeaders(signIn.headers.get("set-cookie") ?? "");
    assert.equal((await auth.api.getSession({ headers }))?.user.email, email);

    const enabled = await auth.api.enableTwoFactor({
      headers,
      body: { password, issuer: "Kelpie test" },
    });
    const secret = new URL(enabled.totpURI).searchParams.get("secret");
    assert.ok(secret, "MFA enrolment must return a TOTP secret");
    await auth.api.verifyTOTP({
      headers,
      body: { code: currentTotp(secret), trustDevice: false },
    });

    const [enrolled] = await db
      .select({ twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, signUp.user.id))
      .limit(1);
    assert.equal(enrolled?.twoFactorEnabled, true);
    console.log("Better Auth sign-up, sign-in, session, and TOTP enrolment passed.");
  } finally {
    await db.delete(users).where(eq(users.id, signUp.user.id));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
