import { Transform, type TransformFnParams } from "class-transformer";
import { IsBoolean, IsOptional, Matches, ValidateIf } from "class-validator";
import { PHONE_E164_REGEX } from "../reminder.constants";

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === "string" ? value.trim() : value;

export class UpdateReminderSettingsDto {
  /** E.164 destination; `null` clears it (reminders are then skipped). */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((o: UpdateReminderSettingsDto) => o.phoneE164 !== null)
  @Matches(PHONE_E164_REGEX, {
    message: "phoneE164 must be E.164 (e.g. +5511999998888)",
  })
  phoneE164?: string | null;

  @IsBoolean()
  enabled!: boolean;
}
