import { loadConfig } from "./env.schema";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public",
  JWT_SECRET: "test-secret-at-least-16-chars",
};

// 52-char base64 (decodes to 39 bytes ≥ 32) with diverse charset — strong.
const strongSecret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP";

describe("loadConfig", () => {
  it("parses a valid environment into a typed, frozen config", () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      nodeEnv: "test",
      port: 3000,
      databaseUrl: "postgresql://u:p@localhost:5432/db?schema=public",
      apiPrefix: "api",
      apiVersion: "1",
      jwtAccessTtl: "15m",
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("exposes default rate limits", () => {
    const { authRateLimits } = loadConfig(validEnv);
    expect(authRateLimits.login).toEqual({ limit: 5, ttlMs: 60_000 });
    expect(authRateLimits.register).toEqual({ limit: 3, ttlMs: 60_000 });
    expect(authRateLimits.default).toEqual({ limit: 100, ttlMs: 60_000 });
  });

  it("throws when a required variable (DATABASE_URL) is missing", () => {
    const incomplete = {
      NODE_ENV: validEnv.NODE_ENV,
      PORT: validEnv.PORT,
      JWT_SECRET: validEnv.JWT_SECRET,
    };
    expect(() => loadConfig(incomplete)).toThrow(/DATABASE_URL/);
  });

  it("does not leak the offending value in the error message", () => {
    const secret = "postgresql://leak:secret@host/db";
    try {
      loadConfig({ ...validEnv, PORT: "not-a-number", DATABASE_URL: secret });
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/PORT/);
      expect(message).not.toContain("not-a-number");
    }
  });

  describe("JWT secret strength (non-test envs)", () => {
    const prodEnv = {
      ...validEnv,
      NODE_ENV: "production",
      JWT_SECRET: strongSecret,
    };

    it("accepts a strong base64 secret", () => {
      expect(loadConfig(prodEnv).jwtSecret).toBe(strongSecret);
    });

    it("rejects a placeholder secret", () => {
      expect(() => loadConfig({ ...prodEnv, JWT_SECRET: "secret" })).toThrow(
        /JWT_SECRET/,
      );
    });

    it("rejects a too-short secret", () => {
      expect(() =>
        loadConfig({ ...prodEnv, JWT_SECRET: "short12345" }),
      ).toThrow(/JWT_SECRET/);
    });
  });

  describe("JWT_ACCESS_TTL range", () => {
    it("rejects a TTL below 5m", () => {
      expect(() => loadConfig({ ...validEnv, JWT_ACCESS_TTL: "2m" })).toThrow(
        /JWT_ACCESS_TTL/,
      );
    });

    it("rejects a TTL above 1h", () => {
      expect(() => loadConfig({ ...validEnv, JWT_ACCESS_TTL: "2h" })).toThrow(
        /JWT_ACCESS_TTL/,
      );
    });
  });

  describe("rate-limit validation", () => {
    it("rejects non-positive points", () => {
      expect(() =>
        loadConfig({ ...validEnv, AUTH_LOGIN_RATE_LIMIT_POINTS: "0" }),
      ).toThrow(/AUTH_LOGIN_RATE_LIMIT_POINTS/);
    });

    it("rejects an invalid window duration", () => {
      expect(() =>
        loadConfig({ ...validEnv, AUTH_LOGIN_RATE_LIMIT_WINDOW: "nonsense" }),
      ).toThrow(/AUTH_LOGIN_RATE_LIMIT_WINDOW/);
    });
  });

  describe("notification provider selection", () => {
    it("defaults to the log provider with no credentials required", () => {
      const config = loadConfig(validEnv);
      expect(config.notificationProvider).toBe("log");
      expect(config.whatsapp).toBeNull();
    });

    it("rejects an unknown provider", () => {
      expect(() =>
        loadConfig({ ...validEnv, NOTIFICATION_PROVIDER: "carrier-pigeon" }),
      ).toThrow(/NOTIFICATION_PROVIDER/);
    });

    it("requires both WhatsApp credentials when provider is whatsapp", () => {
      expect(() =>
        loadConfig({ ...validEnv, NOTIFICATION_PROVIDER: "whatsapp" }),
      ).toThrow(/WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID/);
      expect(() =>
        loadConfig({
          ...validEnv,
          NOTIFICATION_PROVIDER: "whatsapp",
          WHATSAPP_API_TOKEN: "tok",
        }),
      ).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    });

    it("accepts whatsapp with both credentials and exposes them", () => {
      const config = loadConfig({
        ...validEnv,
        NOTIFICATION_PROVIDER: "whatsapp",
        WHATSAPP_API_TOKEN: "tok",
        WHATSAPP_PHONE_NUMBER_ID: "12345",
      });
      expect(config.notificationProvider).toBe("whatsapp");
      expect(config.whatsapp).toEqual({
        apiToken: "tok",
        phoneNumberId: "12345",
      });
    });

    it("does not leak credential values in validation errors", () => {
      try {
        loadConfig({
          ...validEnv,
          NOTIFICATION_PROVIDER: "whatsapp",
          WHATSAPP_API_TOKEN: "super-secret-token",
        });
        throw new Error("expected loadConfig to throw");
      } catch (err) {
        expect((err as Error).message).not.toContain("super-secret-token");
      }
    });
  });
});
