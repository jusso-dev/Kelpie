import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://kelpie:kelpie@localhost:5432/kelpie",
  },
  strict: true,
  verbose: true,
} satisfies Config;
