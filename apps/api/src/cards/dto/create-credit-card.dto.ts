import { Transform, type TransformFnParams } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateCreditCardDto {
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  closingDay!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDay!: number;

  // Optional credit limit in BRL minor units. Non-negative safe integer. This
  // spec does NOT enforce available-limit checks (out of scope).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  creditLimitMinor?: number;
}
