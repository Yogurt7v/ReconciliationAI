import React, { useState } from 'react';
import { testAnalyze, compareDocuments, generateReport } from '../api';
import { ResultsTable } from './ResultsTable';
import { ReasoningLog } from './ReasoningLog';

interface MainScreenProps {
  onOpenSettings: () => void;
  currentModel: string;
  apiKey: string;
}

export const MainScreen: React.FC<MainScreenProps> = ({
  onOpenSettings,
  currentModel,
  apiKey
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'analyze' | 'compare'>('analyze');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (mode === 'compare' && newFiles.length > 2) {
        alert('Для сравнения выберите не более 2 файлов');
        return;
      }
      setFiles(newFiles);
      setResult(null);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    if (mode === 'compare' && files.length !== 2) {
      setError('Выберите ровно 2 файла для сравнения');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let data;
      if (mode === 'analyze') {
        data = await testAnalyze(files, apiKey, currentModel);
      } else {
        data = await compareDocuments(files, apiKey, currentModel);
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!result) return;
    try {
      const url = await generateReport(result.extractedData || result);
      window.open(url, '_blank');
    } catch (err: any) {
      alert('Ошибка экспорта: ' + err.message);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800">
          {mode === 'analyze' ? 'Распознавание документов' : 'Сравнение документов'}
        </h1>
        <button
          onClick={onOpenSettings}
          className="px-4 py-2 text-sm text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
        >
          ⚙️ Настройки AI ({currentModel.split('/')[1]})
        </button>
      </header>

      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <div className="flex space-x-4 mb-4">
          <button
            onClick={() => { setMode('analyze'); setFiles([]); setResult(null); }}
            className={`px-4 py-2 rounded-md ${mode === 'analyze' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Анализ одного файла
          </button>
          <button
            onClick={() => { setMode('compare'); setFiles([]); setResult(null); }}
            className={`px-4 py-2 rounded-md ${mode === 'compare' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Сравнение двух файлов
          </button>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
          <input
            type="file"
            multiple={mode === 'analyze'}
            accept=".pdf,.xlsx"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <span className="text-4xl">📄</span>
            <p className="mt-2 text-gray-600">
              {files.length > 0
                ? `Выбрано файлов: ${files.map(f => f.name).join(', ')}`
                : 'Нажмите или перетащите файлы сюда'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF (текст/скан) или XLSX</p>
          </label>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
            ⚠️ {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || files.length === 0}
          className="mt-4 w-full py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? 'Обработка...' : (mode === 'analyze' ? 'Распознать' : 'Сравнить')}
        </button>
      </div>

      {result && (
        <div className="space-y-6">
          <ResultsTable data={result.extractedData || result} onExport={handleExport} />
          {result.reasoningLog && <ReasoningLog logs={result.reasoningLog} />}
        </div>
      )}
    </div>
  );
};
