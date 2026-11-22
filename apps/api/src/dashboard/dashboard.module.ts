import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";

/**
 * Monthly dashboard: a read-only summary across all four ledger sources. Owns
 * no table — it reads `transactions` and the reminders-owned paid markers and
 * writes nothing. Routes protected by the global JwtAuthGuard.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
})
export class DashboardModule {}
