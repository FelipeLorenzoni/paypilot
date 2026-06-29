import { loadConfig } from "./env.schema";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public",
};

describe("loadConfig", () => {
  it("parses a valid environment into a typed, frozen config", () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      nodeEnv: "test",
      port: 3000,
      databaseUrl: "postgresql://u:p@localhost:5432/db?schema=public",
      apiPrefix: "api",
      apiVersion: "1",
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("coerces PORT to a number", () => {
    expect(loadConfig(validEnv).port).toBe(3000);
  });

  it("throws when a required variable (DATABASE_URL) is missing", () => {
    const incomplete = { NODE_ENV: validEnv.NODE_ENV, PORT: validEnv.PORT };
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
      expect(message).not.toContain("secret");
      expect(message).not.toContain("not-a-number");
    }
  });
});
