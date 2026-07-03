import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface ReminderSettingsView {
  phoneE164: string | null;
  enabled: boolean;
}

export interface UpdateSettingsInput {
  phoneE164?: string | null;
  enabled: boolean;
}

/**
 * Per-user reminder settings (requirement 6). Opt-in by default: a user
 * without a row reads as `{ phoneE164: null, enabled: false }` and is skipped
 * by the evaluation (never errored). The phone number is never logged here or
 * anywhere else unmasked.
 */
@Injectable()
export class ReminderSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<ReminderSettingsView> {
    const row = await this.prisma.reminderSettings.findUnique({
      where: { userId },
      select: { phoneE164: true, enabled: true },
    });
    return row ?? { phoneE164: null, enabled: false };
  }

  async upsert(
    userId: string,
    input: UpdateSettingsInput,
  ): Promise<ReminderSettingsView> {
    const phoneE164 = input.phoneE164 ?? null;
    const row = await this.prisma.reminderSettings.upsert({
      where: { userId },
      create: { userId, phoneE164, enabled: input.enabled },
      update: { phoneE164, enabled: input.enabled },
      select: { phoneE164: true, enabled: true },
    });
    return row;
  }
}
