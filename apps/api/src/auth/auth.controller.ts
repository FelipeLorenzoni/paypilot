import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { Public } from "./public.decorator";
import type { SafeUser } from "./safe-user";
import { LOGIN_THROTTLE, REGISTER_THROTTLE } from "./throttle.config";
import type { RequestWithId } from "../common/request-id";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: REGISTER_THROTTLE })
  @Post("register")
  register(
    @Body() dto: RegisterDto,
    @Req() req: RequestWithId,
  ): Promise<SafeUser> {
    return this.auth.register(dto, req.requestId);
  }

  @Public()
  @Throttle({ default: LOGIN_THROTTLE })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Req() req: RequestWithId,
  ): Promise<{ accessToken: string }> {
    return this.auth.login(dto, req.requestId);
  }

  @Get("me")
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }
}
