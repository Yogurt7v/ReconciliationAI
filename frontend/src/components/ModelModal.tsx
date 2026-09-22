import React from 'react';
import { AiModel, AI_MODELS } from '../config';

interface ModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  currentApiKey: string;
  onSave: (model: string, apiKey: string) => void;
}

export const ModelModal: React.FC<ModelModalProps> = ({
  isOpen,
  onClose,
  currentModel,
  currentApiKey,
  onSave
}) => {
  const [selectedModel, setSelectedModel] = React.useState(currentModel);
  const [apiKeyInput, setApiKeyInput] = React.useState(currentApiKey);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(selectedModel, apiKeyInput);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="text-xl font-bold mb-4 text-gray-800">Настройки AI</h2>

        {/* Секция API Key */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            OpenRouter API Key
          </label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="sk-or-..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Ключ хранится локально в браузере.{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
              Получить ключ
            </a>
          </p>
        </div>

        {/* Секция выбора модели */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Модель
          </label>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {AI_MODELS.map((m: AiModel) => (
              <label
                key={m.id}
                className={`flex items-start p-3 border rounded-md cursor-pointer transition-colors ${
                  selectedModel === m.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={selectedModel === m.id}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900">{m.name}</div>
                  <div className="text-xs text-gray-500">{m.provider}</div>
                  <div className="text-xs text-gray-600 mt-1">{m.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
};
