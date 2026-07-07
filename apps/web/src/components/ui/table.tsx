import type { ReactNode } from "react";
import styles from "./table.module.css";

export interface TableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  caption: string;
  columns: Array<TableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
}

/** Semantic data table (caption + header cells) for tabular data. */
export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
}: TableProps<T>): ReactNode {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.header}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
