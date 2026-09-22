import React, { useState } from 'react';

interface ReasoningLogProps {
  logs: string[];
}

export const ReasoningLog: React.FC<ReasoningLogProps> = ({ logs }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex justify-between items-center bg-gray-50 hover:bg-gray-100 transition-colors rounded-t-lg"
      >
        <span className="font-medium text-gray-700">🧠 Логика AI и этапы обработки</span>
        <span className="text-gray-500 text-sm">{isOpen ? 'Свернуть' : 'Развернуть'}</span>
      </button>

      {isOpen && (
        <div className="p-4 bg-gray-900 text-green-400 font-mono text-xs overflow-y-auto max-h-96 rounded-b-lg">
          {logs.map((log, idx) => (
            <div key={idx} className="mb-2 border-b border-gray-800 pb-2 last:border-0">
              <span className="text-gray-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
              {log}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
