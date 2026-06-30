import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { ClockModule } from "./common/clock.module";
import { APP_CONFIG, type AppConfig } from "./config/app-config";
import { AppConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * Root application module. The foundation cross-cutting modules plus auth.
 * Global guards are registered here so their order is explicit: the
 * ThrottlerGuard runs BEFORE the JwtAuthGuard (throttle abusive traffic before
 * the guard's per-request active-user DB lookup).
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ClockModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            name: "default",
            ttl: config.authRateLimits.default.ttlMs,
            limit: config.authRateLimits.default.limit,
          },
        ],
      }),
    }),
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
