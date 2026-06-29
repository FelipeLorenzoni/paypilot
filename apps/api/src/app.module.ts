import { Module } from "@nestjs/common";
import { ClockModule } from "./common/clock.module";
import { AppConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * Root application module. Feature modules (auth, expenses, bills, ...) are
 * added here in later specs. The foundation only wires cross-cutting modules.
 */
@Module({
  imports: [AppConfigModule, PrismaModule, ClockModule, HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
