import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";

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
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "dev_only_secret_change_me_please_change_me_please_change_me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
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
