import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { SafeUser } from "./safe-user";

/** Injects the authenticated {@link SafeUser} attached by the JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SafeUser => {
    const req = ctx.switchToHttp().getRequest<{ user: SafeUser }>();
    return req.user;
  },
);
