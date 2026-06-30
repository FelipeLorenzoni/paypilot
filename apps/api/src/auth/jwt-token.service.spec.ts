import { JwtService } from "@nestjs/jwt";
import type { AppConfig } from "../config/app-config";
import { JwtTokenService } from "./jwt-token.service";

const secret = "test-jwt-secret-at-least-32-bytes-long-xxxx";
const config = { jwtAccessTtl: "15m" } as unknown as AppConfig;

function makeService(): { service: JwtTokenService; jwt: JwtService } {
  const jwt = new JwtService({ secret });
  return { service: new JwtTokenService(jwt, config), jwt };
}

describe("JwtTokenService", () => {
  it("signs a token with sub and exp", async () => {
    const { service } = makeService();
    const token = await service.sign("user-1");
    const claims = await service.verify(token);
    expect(claims.sub).toBe("user-1");
    expect(typeof claims.exp).toBe("number");
  });

  it("rejects a tampered token", async () => {
    const { service } = makeService();
    const token = await service.sign("user-1");
    await expect(service.verify(`${token}tamper`)).rejects.toBeDefined();
  });

  it("rejects an expired token", async () => {
    const { service, jwt } = makeService();
    const expired = await jwt.signAsync(
      { sub: "user-1" },
      { issuer: "paypilot", algorithm: "HS256", expiresIn: "-1s" },
    );
    await expect(service.verify(expired)).rejects.toBeDefined();
  });

  it("rejects an unexpected algorithm (alg pinning)", async () => {
    const { service, jwt } = makeService();
    const hs512 = await jwt.signAsync(
      { sub: "user-1" },
      { issuer: "paypilot", algorithm: "HS512", expiresIn: "15m" },
    );
    await expect(service.verify(hs512)).rejects.toBeDefined();
  });
});
