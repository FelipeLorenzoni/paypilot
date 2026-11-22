import type { ReactNode } from "react";
import type { CategorySubtotal } from "@paypilot/shared";
import { Table } from "../../components/ui/table";
import { formatMoney } from "../../lib/format";

const COLUMNS = [
  {
    header: "Category",
    render: (row: CategorySubtotal) => row.label ?? "Uncategorized",
  },
  {
    header: "Amount",
    render: (row: CategorySubtotal) => formatMoney(row.amountMinor, "BRL"),
  },
];

/** Category table in the backend's order (amount descending). */
export function CategoryBreakdown({
  categories,
}: {
  categories: CategorySubtotal[];
}): ReactNode {
  return (
    <Table
      caption="Spending by category"
      columns={COLUMNS}
      rows={categories}
      rowKey={(row) => row.label ?? "\u0000uncategorized"}
    />
  );
}
