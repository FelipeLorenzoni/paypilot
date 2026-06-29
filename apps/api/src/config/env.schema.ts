import { z } from "zod";

/**
 * Raw environment schema. Keep names aligned with `.env.example`.
 * Validation runs at startup; on failure the app fails fast (see config.module).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  API_PREFIX: z.string().min(1).default("api"),
  API_VERSION: z.string().min(1).default("1"),
});

/** Typed, immutable application configuration consumed across the API. */
export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly databaseUrl: string;
  readonly apiPrefix: string;
  readonly apiVersion: string;
}

/**
 * Validate `env` and return a frozen {@link AppConfig}. Throws when required
 * variables are missing or malformed. The error reports only variable NAMES,
 * never their values (no secret leakage — see steering `security.md`).
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]
      .filter((name) => name.length > 0)
      .join(", ");
    throw new Error(
      `Invalid environment configuration. Offending variable(s): ${names}`,
    );
  }

  const e = parsed.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    apiPrefix: e.API_PREFIX,
    apiVersion: e.API_VERSION,
  });
}
