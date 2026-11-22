import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  ValidateIf,
} from "class-validator";
import { IsIsoCalendarDate } from "../../common/is-iso-date.validator";
import type { ReminderTargetType } from "../../reminders/domain/reminder-target";

const CYCLE_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Mark/unmark a payable item. `targetType` discriminates the required
 * identity parts; the canonical key is always derived server-side. The
 * not-in-the-future rule needs the injected clock, so it lives in the service.
 */
export class SetBillPaymentDto {
  @IsIn(["RECURRING_TRANSACTION", "CARD_INVOICE"])
  targetType!: ReminderTargetType;

  @ValidateIf(
    (o: SetBillPaymentDto) => o.targetType === "RECURRING_TRANSACTION",
  )
  @IsUUID()
  transactionId?: string;

  @ValidateIf((o: SetBillPaymentDto) => o.targetType === "CARD_INVOICE")
  @IsUUID()
  creditCardId?: string;

  @ValidateIf((o: SetBillPaymentDto) => o.targetType === "CARD_INVOICE")
  @Matches(CYCLE_REGEX, { message: "invoiceCycle must be YYYY-MM" })
  invoiceCycle?: string;

  @IsBoolean()
  paid!: boolean;

  @IsOptional()
  @IsIsoCalendarDate()
  paidOn?: string;
}
