import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { UsersRepository } from "../users/users.repository";
import type { LoginDto } from "./dto/login.dto";
import type { RegisterDto } from "./dto/register.dto";
import { JwtTokenService } from "./jwt-token.service";
import { PasswordHasher } from "./password-hasher";
import type { SafeUser } from "./safe-user";

const PRISMA_UNIQUE_VIOLATION = "P2002";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: JwtTokenService,
  ) {}

  async register(dto: RegisterDto, requestId: string): Promise<SafeUser> {
    const passwordHash = await this.hasher.hash(dto.password);
    try {
      const user = await this.users.create(dto.email, passwordHash);
      this.logger.log(
        `auth.register requestId=${requestId} result=success userId=${user.id}`,
      );
      return this.toSafeUser(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(
          `auth.register requestId=${requestId} result=conflict`,
        );
        throw new ConflictException("Email already registered");
      }
      throw error; // unknown DB/internal error → generic 500 (no leak via filter)
    }
  }

  async login(
    dto: LoginDto,
    requestId: string,
  ): Promise<{ accessToken: string }> {
    const user = await this.users.findByEmail(dto.email);
    // Constant-time: always verify — dummy hash when the user is missing.
    const valid = user
      ? await this.hasher.verify(user.passwordHash, dto.password)
      : await this.hasher.verifyAgainstDummy(dto.password);

    if (!user || !valid) {
      this.logger.warn(`auth.login requestId=${requestId} result=failure`);
      throw new UnauthorizedException("Invalid credentials");
    }

    const accessToken = await this.tokens.sign(user.id);
    this.logger.log(
      `auth.login requestId=${requestId} result=success userId=${user.id}`,
    );
    return { accessToken };
  }

  toSafeUser(user: { id: string; email: string; createdAt: Date }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === PRISMA_UNIQUE_VIOLATION
    );
  }
}
