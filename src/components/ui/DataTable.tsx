import { ReactNode } from 'react';
import Skeleton from './Skeleton';

type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
};

type DataTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage: string;
  loading?: boolean;
  loadingLines?: number;
  ariaLabel: string;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string | null;
};

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage,
  loading = false,
  loadingLines = 3,
  ariaLabel,
  onRowClick,
  selectedRowKey,
}: DataTableProps<T>) {
  return (
    <div className="ui-table-wrap">
      <table className="trainings-table ui-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ textAlign: column.align || 'left' }}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length}>
                <Skeleton lines={loadingLines} />
              </td>
            </tr>
          )}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          )}

          {!loading &&
            rows.map((row) => {
              const key = rowKey(row);
              const isSelected = Boolean(selectedRowKey && selectedRowKey === key);

              return (
                <tr
                  key={key}
                  className={isSelected ? 'ui-table__row is-selected' : 'ui-table__row'}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((column) => (
                    <td key={`${key}-${column.key}`} style={{ textAlign: column.align || 'left' }}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
