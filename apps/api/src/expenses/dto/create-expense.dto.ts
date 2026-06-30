import { Transform, type TransformFnParams } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  Max,
  MaxLength,
} from "class-validator";
import { IsIsoCalendarDate } from "../../common/is-iso-date.validator";

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateExpenseDto {
  @IsInt()
  @IsPositive()
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @Transform(({ value }: TransformFnParams) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsIn(["BRL"])
  currency!: string;

  @IsIsoCalendarDate()
  expenseDate!: string;

  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @IsOptional()
  @Transform(trim)
  @MaxLength(100)
  category?: string;
}
