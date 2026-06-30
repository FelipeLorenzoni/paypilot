import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { UsersRepository } from "../users/users.repository";
import { JwtTokenService } from "./jwt-token.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { SafeUser } from "./safe-user";

/**
 * Global authentication guard. Skips `@Public()` routes. Otherwise verifies the
 * Bearer token (signature/exp/pinned algorithm), then loads the user by `sub`
 * and checks `isActive` — rejecting missing/disabled/deleted users (stateless
 * active-user verification). Attaches the {@link SafeUser} to the request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: JwtTokenService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: SafeUser }>();
    const token = this.extractBearer(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException();
    }

    let sub: string;
    try {
      sub = (await this.tokens.verify(token)).sub;
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.users.findActiveById(sub);
    if (!user) {
      throw new UnauthorizedException();
    }

    req.user = {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
    return true;
  }

  private extractBearer(header: string | undefined): string | null {
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(" ");
    return scheme === "Bearer" && value ? value : null;
  }
}
