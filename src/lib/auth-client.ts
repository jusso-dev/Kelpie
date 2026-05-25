"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
      : window.location.origin,
  plugins: [
    twoFactorClient({
      twoFactorPage: "/two-factor",
    }),
  ],
});

export const { signIn, signOut, signUp, useSession } = authClient;
