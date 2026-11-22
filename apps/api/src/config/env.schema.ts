import ms from "ms";
import { z } from "zod";

const PLACEHOLDER_SECRETS = new Set([
  "secret",
  "super-secret",
  "supersecret",
  "changeme",
  "change-me",
  "password",
  "placeholder",
  "<replace-with-256-bit-random-secret>",
]);

const TTL_MIN_MS = 5 * 60 * 1000; // 5m
const TTL_MAX_MS = 60 * 60 * 1000; // 1h

// `ms`'s types only accept its `StringValue` template type; wrap it to accept
// arbitrary strings (it returns `undefined` for unparseable input at runtime).
const msToNumber = ms as unknown as (value: string) => number | undefined;

/** Parse a duration string (e.g. "15m") to positive ms, or null if invalid. */
function parseDurationMs(value: string): number | null {
  const result = msToNumber(value);
  return typeof result === "number" && Number.isFinite(result) && result > 0
    ? result
    : null;
}

/** Byte length of a base64/base64url secret (falls back to utf8 bytes). */
function decodedByteLength(value: string): number {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (
    normalized.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    return Buffer.from(normalized, "base64").length;
  }
  return Buffer.byteLength(value, "utf8");
}

/**
 * JWT secret strength: in non-test envs require ≥ 256 bits of entropy
 * (decoded ≥ 32 bytes), reject placeholders and low-charset-diversity values.
 * Tests are lenient (≥ 16 chars) so suites don't need a production-grade secret.
 */
function isStrongSecret(secret: string, nodeEnv: string): boolean {
  if (nodeEnv === "test") return secret.length >= 16;
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) return false;
  if (new Set(secret).size < 8) return false;
  return decodedByteLength(secret) >= 32;
}

/**
 * True for a timezone name the runtime's ICU resolves (IANA names and `UTC`).
 * Offset strings such as `+03:00` are accepted by `Intl` but are not zone
 * names (they never observe DST), so they are rejected.
 */
export function isIanaTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    API_PREFIX: z.string().min(1).default("api"),
    API_VERSION: z.string().min(1).default("1"),

    JWT_SECRET: z.string().min(1),
    JWT_ACCESS_TTL: z.string().min(1).default("15m"),

    AUTH_LOGIN_RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(5),
    AUTH_LOGIN_RATE_LIMIT_WINDOW: z.string().min(1).default("1m"),
    AUTH_REGISTER_RATE_LIMIT_POINTS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    AUTH_REGISTER_RATE_LIMIT_WINDOW: z.string().min(1).default("1m"),
    AUTH_DEFAULT_RATE_LIMIT_POINTS: z.coerce
      .number()
      .int()
      .positive()
      .default(100),
    AUTH_DEFAULT_RATE_LIMIT_WINDOW: z.string().min(1).default("1m"),

    // due-date-reminders: outbound provider selection. Defaults to the
    // fake/log provider, which needs no credentials (dev/test default per
    // steering integrations.md). The WhatsApp credentials are required iff
    // the whatsapp provider is selected (checked in superRefine).
    NOTIFICATION_PROVIDER: z.enum(["log", "whatsapp"]).default("log"),
    WHATSAPP_API_TOKEN: z.string().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),

    // app-timezone: the business timezone every "today"/current month is
    // derived in (docs/conventions.md — explicit zone, never the server's).
    APP_TIME_ZONE: z.string().min(1).default("America/Sao_Paulo"),
  })
  .superRefine((env, ctx) => {
    if (env.NOTIFICATION_PROVIDER === "whatsapp") {
      for (const field of [
        "WHATSAPP_API_TOKEN",
        "WHATSAPP_PHONE_NUMBER_ID",
      ] as const) {
        if (!env[field]) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required when NOTIFICATION_PROVIDER=whatsapp`,
          });
        }
      }
    }
    if (!isStrongSecret(env.JWT_SECRET, env.NODE_ENV)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "JWT_SECRET is missing, too weak, or a placeholder",
      });
    }
    if (!isIanaTimeZone(env.APP_TIME_ZONE)) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_TIME_ZONE"],
        message: "APP_TIME_ZONE must be an IANA timezone name",
      });
    }
    const ttl = parseDurationMs(env.JWT_ACCESS_TTL);
    if (ttl === null || ttl < TTL_MIN_MS || ttl > TTL_MAX_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_TTL"],
        message: "JWT_ACCESS_TTL must be a duration between 5m and 1h",
      });
    }
    for (const field of [
      "AUTH_LOGIN_RATE_LIMIT_WINDOW",
      "AUTH_REGISTER_RATE_LIMIT_WINDOW",
      "AUTH_DEFAULT_RATE_LIMIT_WINDOW",
    ] as const) {
      if (parseDurationMs(env[field]) === null) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must be a positive duration`,
        });
      }
    }
  });

export interface RateLimitConfig {
  readonly limit: number;
  readonly ttlMs: number;
}

/** Typed, immutable application configuration consumed across the API. */
export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly databaseUrl: string;
  readonly apiPrefix: string;
  readonly apiVersion: string;
  readonly jwtSecret: string;
  readonly jwtAccessTtl: string;
  readonly authRateLimits: {
    readonly login: RateLimitConfig;
    readonly register: RateLimitConfig;
    readonly default: RateLimitConfig;
  };
  /** Outbound notification provider selection (due-date-reminders). */
  readonly notificationProvider: "log" | "whatsapp";
  /** Present iff `notificationProvider === "whatsapp"`. Never logged. */
  readonly whatsapp: {
    readonly apiToken: string;
    readonly phoneNumberId: string;
  } | null;
  /** Business timezone (IANA name) for calendar dates (app-timezone). */
  readonly timeZone: string;
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
    jwtSecret: e.JWT_SECRET,
    jwtAccessTtl: e.JWT_ACCESS_TTL,
    authRateLimits: {
      login: {
        limit: e.AUTH_LOGIN_RATE_LIMIT_POINTS,
        ttlMs: parseDurationMs(e.AUTH_LOGIN_RATE_LIMIT_WINDOW) ?? 60_000,
      },
      register: {
        limit: e.AUTH_REGISTER_RATE_LIMIT_POINTS,
        ttlMs: parseDurationMs(e.AUTH_REGISTER_RATE_LIMIT_WINDOW) ?? 60_000,
      },
      default: {
        limit: e.AUTH_DEFAULT_RATE_LIMIT_POINTS,
        ttlMs: parseDurationMs(e.AUTH_DEFAULT_RATE_LIMIT_WINDOW) ?? 60_000,
      },
    },
    notificationProvider: e.NOTIFICATION_PROVIDER,
    whatsapp:
      e.NOTIFICATION_PROVIDER === "whatsapp"
        ? Object.freeze({
            // superRefine guarantees presence when the provider is whatsapp.
            apiToken: e.WHATSAPP_API_TOKEN as string,
            phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID as string,
          })
        : null,
    timeZone: e.APP_TIME_ZONE,
  });
}
