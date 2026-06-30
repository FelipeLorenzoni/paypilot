import { Transform, type TransformFnParams } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { IsIsoCalendarDate } from "../../common/is-iso-date.validator";

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateRecurringBillDto {
  @IsInt()
  @IsPositive()
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @Transform(({ value }: TransformFnParams) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsIn(["BRL"])
  currency!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @IsOptional()
  @Transform(trim)
  @MaxLength(100)
  category?: string;

  @IsIsoCalendarDate()
  startDate!: string;

  // Cross-field rule `endDate >= startDate` is enforced in the service (mirrors
  // the expenses `from <= to` check), since it spans two fields.
  @IsOptional()
  @IsIsoCalendarDate()
  endDate?: string;
}
