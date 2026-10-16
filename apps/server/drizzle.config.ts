import "./src/load-env.js";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Neon: schema tooling needs the direct (non-pooled) endpoint.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgresql://tableapp:tableapp@localhost:5432/tableapp",
  },
});
