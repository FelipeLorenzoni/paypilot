import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { GenerationScheduler } from "./generation.scheduler";
import { GenerationService } from "./generation.service";
import { RecurringBillsController } from "./recurring-bills.controller";
import { RecurringBillsRepository } from "./recurring-bills.repository";
import { RecurringBillsService } from "./recurring-bills.service";

/**
 * Recurring bills: owner-scoped CRUD plus idempotent monthly generation into
 * the Transaction ledger. PrismaService and the Clock are global; routes are
 * protected by the global JwtAuthGuard. The scheduler runs in-process via
 * @nestjs/schedule (no public HTTP generation trigger; CLI for manual runs).
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [RecurringBillsController],
  providers: [
    RecurringBillsService,
    RecurringBillsRepository,
    GenerationService,
    GenerationScheduler,
  ],
})
export class RecurringBillsModule {}
