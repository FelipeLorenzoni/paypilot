import { Inject, Injectable } from "@nestjs/common";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import { APP_CONFIG, type AppConfig } from "../config/app-config";

const JWT_ALGORITHM = "HS256" as const;
const JWT_ISSUER = "paypilot";

export interface AccessTokenClaims {
  sub: string;
  exp: number;
  iat?: number;
  iss?: string;
}

/**
 * Signs/verifies short-lived access tokens. The signing algorithm is pinned to
 * HS256 on both sign and verify (rejecting forged/unexpected `alg`). Payload
 * carries only `sub`/`exp`/`iat`/`iss` — no PII, hashes, or secrets.
 */
@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  sign(userId: string): Promise<string> {
    const options: JwtSignOptions = {
      expiresIn: this.config.jwtAccessTtl as JwtSignOptions["expiresIn"],
      issuer: JWT_ISSUER,
      algorithm: JWT_ALGORITHM,
    };
    return this.jwt.signAsync({ sub: userId }, options);
  }

  verify(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    });
  }
}
