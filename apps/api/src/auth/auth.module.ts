import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtTokenService } from "./jwt-token.service";
import { PasswordHasher } from "./password-hasher";

/**
 * Authentication module. Provides the auth endpoints and the building blocks
 * (hasher, token service) used by the global JwtAuthGuard (registered in
 * AppModule so its order relative to the ThrottlerGuard is explicit).
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtSecret }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordHasher, JwtTokenService],
  exports: [JwtTokenService, UsersModule],
})
export class AuthModule {}
