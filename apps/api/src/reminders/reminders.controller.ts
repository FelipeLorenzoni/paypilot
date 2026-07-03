import { Body, Controller, Get, Put } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { SetPaidDto } from "./dto/set-paid.dto";
import { UpdateReminderSettingsDto } from "./dto/update-reminder-settings.dto";
import { type PaidStatusView, PaidStatusService } from "./paid-status.service";
import {
  type ReminderSettingsView,
  ReminderSettingsService,
} from "./reminder-settings.service";

/**
 * Reminder settings + paid-status endpoints. Protected by the global
 * JwtAuthGuard (401); owner-scoped by `@CurrentUser` — the target's ownership
 * is re-verified in the service (404 without disclosure). No endpoint here
 * (or anywhere in the reminders feature) mutates ledger transactions.
 */
@Controller("reminders")
export class RemindersController {
  constructor(
    private readonly settings: ReminderSettingsService,
    private readonly paidStatus: PaidStatusService,
  ) {}

  @Get("settings")
  getSettings(@CurrentUser() user: SafeUser): Promise<ReminderSettingsView> {
    return this.settings.get(user.id);
  }

  @Put("settings")
  updateSettings(
    @CurrentUser() user: SafeUser,
    @Body() dto: UpdateReminderSettingsDto,
  ): Promise<ReminderSettingsView> {
    return this.settings.upsert(user.id, dto);
  }

  @Put("paid")
  setPaid(
    @CurrentUser() user: SafeUser,
    @Body() dto: SetPaidDto,
  ): Promise<PaidStatusView> {
    return this.paidStatus.setPaid(user.id, dto, dto.paid);
  }
}
