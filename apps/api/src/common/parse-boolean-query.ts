import type { TransformFnParams } from "class-transformer";

/**
 * Explicit boolean parser for optional query params. We intentionally do NOT
 * use `@Type(() => Boolean)`, which coerces any non-empty string (e.g.
 * `"false"`) to `true`. Pair with `@IsBoolean()` so an unrecognized value fails
 * validation (→ 400). Mapping:
 *   - "true"    -> true
 *   - "false"   -> false
 *   - undefined -> undefined (no filter)
 *   - any other -> returned as-is so `@IsBoolean()` fails -> 400
 */
export const parseBooleanQuery = ({ value }: TransformFnParams): unknown => {
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
