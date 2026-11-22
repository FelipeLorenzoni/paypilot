import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { BillPaymentsModule } from "../bill-payments/bill-payments.module";
import { NotificationsModule } from "../integrations/notifications/notifications.module";
import { PaidStatusService } from "./paid-status.service";
import { ReminderDeliveryStore } from "./reminder-delivery.store";
import { ReminderEvaluationService } from "./reminder-evaluation.service";
import { ReminderSettingsService } from "./reminder-settings.service";
import { RemindersController } from "./reminders.controller";
import { RemindersRepository } from "./reminders.repository";
import { RemindersScheduler } from "./reminders.scheduler";

/**
 * Due-date reminders (R1/R2/R7): daily evaluation of unpaid due items behind
 * the NotificationProvider port, plus settings and paid-status endpoints.
 * Reads the ledger cross-feature but never mutates it; all writes go to the
 * reminders-owned side tables. Routes protected by the global JwtAuthGuard;
 * the scheduler runs in-process via @nestjs/schedule (CLI for manual runs).
 */
@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, BillPaymentsModule],
  controllers: [RemindersController],
  providers: [
    RemindersRepository,
    ReminderDeliveryStore,
    ReminderSettingsService,
    PaidStatusService,
    ReminderEvaluationService,
    RemindersScheduler,
  ],
})
export class RemindersModule {}
