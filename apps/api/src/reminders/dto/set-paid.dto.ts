import { IsBoolean, IsIn, IsUUID, Matches, ValidateIf } from "class-validator";
import type { ReminderTargetType } from "../domain/reminder-target";

const CYCLE_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Mark/unmark a reminder-eligible item as paid. `targetType` discriminates the
 * required identity fields; the canonical `targetKey` is always derived
 * server-side from these validated parts (never accepted as a raw string).
 */
export class SetPaidDto {
  @IsIn(["RECURRING_TRANSACTION", "CARD_INVOICE"])
  targetType!: ReminderTargetType;

  @ValidateIf((o: SetPaidDto) => o.targetType === "RECURRING_TRANSACTION")
  @IsUUID()
  transactionId?: string;

  @ValidateIf((o: SetPaidDto) => o.targetType === "CARD_INVOICE")
  @IsUUID()
  creditCardId?: string;

  @ValidateIf((o: SetPaidDto) => o.targetType === "CARD_INVOICE")
  @Matches(CYCLE_REGEX, { message: "invoiceCycle must be YYYY-MM" })
  invoiceCycle?: string;

  @IsBoolean()
  paid!: boolean;
}
