import {
  ConflictException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { JwtTokenService } from "./jwt-token.service";
import type { PasswordHasher } from "./password-hasher";
import { AuthService } from "./auth.service";
import type { UsersRepository } from "../users/users.repository";

const findByEmail = jest.fn();
const create = jest.fn();
const hash = jest.fn();
const verify = jest.fn();
const verifyAgainstDummy = jest.fn();
const sign = jest.fn();

const users = { findByEmail, create } as unknown as UsersRepository;
const hasher = {
  hash,
  verify,
  verifyAgainstDummy,
} as unknown as PasswordHasher;
const tokens = { sign } as unknown as JwtTokenService;
const service = new AuthService(users, hasher, tokens);

afterEach(() => jest.clearAllMocks());

describe("AuthService", () => {
  it("login fails with generic 401 and logs no sensitive data", async () => {
    findByEmail.mockResolvedValue(null);
    verifyAgainstDummy.mockResolvedValue(false);
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);

    await expect(
      service.login(
        { email: "victim@example.com", password: "super-secret-pw" },
        "req-9",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(warnSpy).toHaveBeenCalled();
    expect(logged).toContain("req-9");
    expect(logged).not.toContain("victim@example.com");
    expect(logged).not.toContain("super-secret-pw");
    warnSpy.mockRestore();
  });

  it("login runs the dummy verify when the user is missing (constant-time)", async () => {
    findByEmail.mockResolvedValue(null);
    verifyAgainstDummy.mockResolvedValue(false);
    await expect(
      service.login({ email: "x@y.com", password: "p" }, "r"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyAgainstDummy).toHaveBeenCalled();
  });

  it("register maps a unique-constraint violation to 409", async () => {
    hash.mockResolvedValue("hashed");
    create.mockRejectedValue({ code: "P2002" });
    await expect(
      service.register(
        { email: "dup@example.com", password: "x".repeat(12) },
        "r",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("register returns a SafeUser without the password hash", async () => {
    hash.mockResolvedValue("hashed");
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    create.mockResolvedValue({
      id: "u1",
      email: "new@example.com",
      passwordHash: "hashed",
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });
    const result = await service.register(
      { email: "new@example.com", password: "x".repeat(12) },
      "r",
    );
    expect(result).toEqual({
      id: "u1",
      email: "new@example.com",
      createdAt: createdAt.toISOString(),
    });
    expect(result).not.toHaveProperty("passwordHash");
  });
});
