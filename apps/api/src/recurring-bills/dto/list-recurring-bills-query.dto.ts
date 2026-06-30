import { Transform, Type, type TransformFnParams } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Explicit boolean parser for the `active` query param. We intentionally do NOT
 * use `@Type(() => Boolean)`, which coerces any non-empty string (e.g.
 * `"false"`) to `true`. Mapping:
 *   - "true"      -> true
 *   - "false"     -> false
 *   - undefined   -> undefined (no filter)
 *   - any other   -> returned as-is so `@IsBoolean()` fails -> 400
 */
const parseActive = ({ value }: TransformFnParams): unknown => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true" || value === true) {
    return true;
  }
  if (value === "false" || value === false) {
    return false;
  }
  return value;
};

export class ListRecurringBillsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @Transform(parseActive)
  @IsBoolean()
  active?: boolean;
}
