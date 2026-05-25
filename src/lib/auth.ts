import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Blocks email/password sign in for organisations that have force-SSO enabled.
 * SSO entry points (/api/sso/*) create sessions directly and bypass this.
 */
async function passwordSignInBlockedFor(email: string): Promise<boolean> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return false;
  const [u] = await db
    .select({ organisationId: schema.users.organisationId })
    .from(schema.users)
    .where(eq(schema.users.email, normalised))
    .limit(1);
  if (!u?.organisationId) return false;
  const [org] = await db
    .select({ settings: schema.organisations.settings })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, u.organisationId))
    .limit(1);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const sso = settings.sso as { forceSso?: boolean } | undefined;
  return Boolean(sso?.forceSso);
}

export const AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  "dev_only_secret_change_me_please_change_me_please_change_me";

export const AUTH_BASE_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
    },
  }),
  secret: AUTH_SECRET,
  baseURL: AUTH_BASE_URL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      organisationId: { type: "string", required: false, input: false },
      role: { type: "string", required: false, defaultValue: "analyst" },
      banned: { type: "boolean", required: false, input: false },
      banReason: { type: "string", required: false, input: false },
      banExpires: { type: "date", required: false, input: false },
      passwordResetRequired: {
        type: "boolean",
        required: false,
        input: false,
      },
      mfaRequired: { type: "boolean", required: false, input: false },
      twoFactorEnabled: { type: "boolean", required: false, input: false },
      timezone: {
        type: "string",
        required: false,
        defaultValue: "Australia/Sydney",
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const email = (ctx.body as { email?: string } | undefined)?.email ?? "";
        if (await passwordSignInBlockedFor(email)) {
          throw new APIError("FORBIDDEN", {
            message:
              "This organisation requires single sign-on. Use your SSO login.",
          });
        }
      }
    }),
  },
  plugins: [
    admin({
      adminRoles: ["admin"],
      defaultRole: "analyst",
      bannedUserMessage:
        "This account is locked. Contact your Kelpie organisation administrator.",
    }),
    twoFactor({
      issuer: "Kelpie",
      skipVerificationOnEnable: false,
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
