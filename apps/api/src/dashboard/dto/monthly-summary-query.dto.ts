import { IsOptional, Matches } from "class-validator";

export class MonthlySummaryQueryDto {
  /** `YYYY-MM`; omitted → the injected clock's current UTC month. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: "month must be a valid YYYY-MM value",
  })
  month?: string;
}
