import React from 'react';

interface ResultsTableProps {
  data: any[];
  onExport: () => void;
}

export const ResultsTable: React.FC<ResultsTableProps> = ({ data, onExport }) => {
  if (!data || data.length === 0) return null;

  const headers = Object.keys(data[0]);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-800">Результаты извлечения</h2>
        <button
          onClick={onExport}
          className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
        >
          📥 Экспорт в Excel
        </button>
      </div>

      <div className="overflow-x-auto max-h-[600px]">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {headers.map((header) => (
                <th
                  key={header}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50 transition-colors">
                {headers.map((header) => {
                  const value = row[header];
                  // Простая эвристика для подсветки потенциальных ошибок
                  const isError =
                    (header.includes('date') && (!value || isNaN(Date.parse(value)))) ||
                    (header.includes('amount') && (!value || isNaN(parseFloat(String(value).replace(',', '.'))))) ||
                    (header.includes('number') && !value);

                  return (
                    <td key={`${idx}-${header}`} className={`px-6 py-4 whitespace-nowrap text-sm ${isError ? 'text-red-600 font-medium bg-red-50' : 'text-gray-900'}`}>
                      {value !== null && value !== undefined ? String(value) : <span className="text-gray-400 italic">пусто</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 bg-gray-50 text-xs text-gray-500 text-right">
        Всего строк: {data.length}
      </div>
    </div>
  );
};
