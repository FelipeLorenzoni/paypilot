import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Single source of truth for env is the repo-root .env (also used by docker
// compose and the API runtime). prisma.config.ts lives in apps/api, so load the
// root .env explicitly regardless of the CLI's working directory.
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
