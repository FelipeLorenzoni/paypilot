import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

// argon2id parameters (OWASP-aligned): 19 MiB memory, t=2, p=1.
const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Password hashing with argon2id. A dummy hash is precomputed once at startup
 * (same parameters) so login can run a verify for missing users too, equalizing
 * timing and preventing user enumeration (auth-jwt R2.2 / R5).
 */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  private dummyHash = "";

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString("base64"));
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON_OPTIONS);
  }

  verify(hashed: string, password: string): Promise<boolean> {
    return verify(hashed, password);
  }

  /** Verify against the precomputed dummy hash (always false) to equalize timing. */
  async verifyAgainstDummy(password: string): Promise<boolean> {
    const reference =
      this.dummyHash || (await this.hash(randomBytes(32).toString("base64")));
    return verify(reference, password);
  }
}
