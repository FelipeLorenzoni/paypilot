import { CsvStructuralError, parseCsv } from "./csv-parser";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("parseCsv", () => {
  it("parses a comma-delimited file with correct line numbers", () => {
    const parsed = parseCsv(
      buf(
        "date,amount,description\n2026-03-01,10.50,Lunch\n2026-03-02,20,Taxi\n",
      ),
    );
    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({
      record: { date: "2026-03-01", amount: "10.50", description: "Lunch" },
      lineNumber: 2,
    });
    expect(parsed.rows[1]?.lineNumber).toBe(3);
  });

  it("detects the semicolon delimiter and accepts unquoted BR amounts", () => {
    const parsed = parseCsv(
      buf("date;amount;description;category\n2026-03-01;1.234,56;Sofa;home\n"),
    );
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows[0]?.record).toEqual({
      date: "2026-03-01",
      amount: "1.234,56",
      description: "Sofa",
      category: "home",
    });
  });

  it("accepts quoted BR amounts under the comma delimiter (RFC-4180)", () => {
    const parsed = parseCsv(
      buf('date,amount,description\n2026-03-01,"1.234,56","Sofa, big"\n'),
    );
    expect(parsed.rows[0]?.record.amount).toBe("1.234,56");
    expect(parsed.rows[0]?.record.description).toBe("Sofa, big");
  });

  it("skips blank lines but keeps physical line numbers", () => {
    const parsed = parseCsv(
      buf("date,amount,description\n\n2026-03-01,10,Lunch\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.lineNumber).toBe(3);
  });

  it("rejects an empty file", () => {
    expect(() => parseCsv(buf(""))).toThrow(CsvStructuralError);
  });

  it("rejects a bad header (missing required, unknown, duplicate)", () => {
    expect(() => parseCsv(buf("date,amount\n2026-03-01,10\n"))).toThrow(
      CsvStructuralError,
    );
    expect(() =>
      parseCsv(buf("date,amount,description,notes\n2026-03-01,10,x,y\n")),
    ).toThrow(CsvStructuralError);
    expect(() =>
      parseCsv(buf("date,amount,description,description\n2026-03-01,10,x,y\n")),
    ).toThrow(CsvStructuralError);
  });

  it("rejects a column-count mismatch (unquoted comma splits the row)", () => {
    expect(() =>
      parseCsv(buf("date,amount,description\n2026-03-01,1.234,56,Sofa\n")),
    ).toThrow(CsvStructuralError);
  });

  it("accepts a header-only file as zero data rows", () => {
    const parsed = parseCsv(buf("date,amount,description\n"));
    expect(parsed.rows).toEqual([]);
  });
});
