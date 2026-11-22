import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { MonthlySummaryQueryDto } from "./monthly-summary-query.dto";

function errorsFor(query: Record<string, unknown>) {
  return validateSync(plainToInstance(MonthlySummaryQueryDto, query));
}

describe("MonthlySummaryQueryDto", () => {
  it("accepts no month and a valid YYYY-MM month", () => {
    expect(errorsFor({})).toEqual([]);
    expect(errorsFor({ month: "2026-11" })).toEqual([]);
  });

  it("rejects a malformed month", () => {
    for (const month of ["2026-13", "2026-1", "nov", "2026-11-01", ""]) {
      expect(errorsFor({ month })).not.toEqual([]);
    }
  });
});
