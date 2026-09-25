'use client';

import { useId, useState } from 'react';

export interface ChartDataColumn<T> {
  header: string;
  render: (row: T) => string;
}

/**
 * "Show as table" toggle rendering a chart's series as an accessible table,
 * so the same data is available without the SVG.
 */
export default function ChartDataTable<T>({
  caption,
  rows,
  rowKey,
  columns,
}: {
  caption: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: ChartDataColumn<T>[];
}) {
  const [open, setOpen] = useState(false);
  const tableId = useId();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((v) => !v)}
        className="self-start text-xs text-gray-300 underline hover:text-white"
      >
        {open ? 'Hide table' : 'Show as table'}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table id={tableId} className="w-full text-xs text-gray-300">
            <caption className="text-left text-gray-400 mb-1">
              {caption}
            </caption>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={c.header}
                    scope="col"
                    className={`py-1 pr-3 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="border-t border-gray-800">
                  {columns.map((c, i) =>
                    i === 0 ? (
                      <th
                        key={c.header}
                        scope="row"
                        className="py-1 pr-3 text-left font-normal"
                      >
                        {c.render(row)}
                      </th>
                    ) : (
                      <td key={c.header} className="py-1 pr-3 text-right">
                        {c.render(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
