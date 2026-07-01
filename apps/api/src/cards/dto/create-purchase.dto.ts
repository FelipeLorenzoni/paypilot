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
import { MAX_INSTALLMENTS } from "../card.constants";

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreatePurchaseDto {
  // One key per logical purchase request; a retry MUST reuse the same key with
  // the same payload (see the idempotency contract in the design).
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;

  @IsIsoCalendarDate()
  purchaseDate!: string;

  @IsInt()
  @IsPositive()
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @Transform(({ value }: TransformFnParams) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsIn(["BRL"])
  currency!: string;

  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @IsOptional()
  @Transform(trim)
  @MaxLength(100)
  category?: string;

  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS)
  installments!: number;
}
