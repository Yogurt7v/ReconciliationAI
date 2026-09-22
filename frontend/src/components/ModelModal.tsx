import { useEffect, useRef, useState } from 'react';

import { AI_MODELS, DEFAULT_MODEL, API_KEY_STORAGE_KEY } from '../config';
import { XIcon } from './icons';

interface Props {
  open: boolean;
  model: string;
  apiKey: string;
  onClose: () => void;
  onSave: (model: string, apiKey: string) => void;
}

export function ModelModal({ open, model, apiKey, onClose, onSave }: Props) {
  const [selected, setSelected] = useState(model);
  const [customValue, setCustomValue] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(apiKey);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const isPreset = AI_MODELS.some((m) => m.id === model);
      if (isPreset) {
        setSelected(model);
        setIsCustom(false);
        setCustomValue('');
      } else {
        setSelected('');
        setIsCustom(true);
        setCustomValue(model === DEFAULT_MODEL ? '' : model);
      }
      setApiKeyValue(apiKey || '');
    }
  }, [open, model, apiKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = () => {
    let finalModel: string;
    if (isCustom) {
      finalModel = customValue.trim() || DEFAULT_MODEL;
    } else {
      finalModel = selected || DEFAULT_MODEL;
    }
    onSave(finalModel, apiKeyValue.trim());
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-panel" role="dialog" aria-label="Настройки модели ИИ">
        <div className="modal-header">
          <h3 className="modal-title">Модель ИИ и API ключ</h3>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {/* API Key Section */}
          <div className="modal-api-key-section">
            <label className="modal-label">
              OpenRouter API Key
              <input
                className="modal-api-key-input"
                type="password"
                placeholder="sk-or-..."
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
              />
            </label>
            <p className="modal-hint">
              Ключ сохраняется локально в браузере. Получите на{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                openrouter.ai/keys
              </a>
            </p>
          </div>

          {/* Model Selection */}
          {AI_MODELS.length > 0 && (
            <div className="modal-model-list">
              <p className="modal-label">Выберите модель:</p>
              {AI_MODELS.map((m) => (
                <label key={m.id} className="modal-model-option">
                  <input
                    type="radio"
                    name="ai-model"
                    value={m.id}
                    checked={!isCustom && selected === m.id}
                    onChange={() => { setSelected(m.id); setIsCustom(false); }}
                  />
                  <span className="modal-model-info">
                    <span className="modal-model-name">{m.name}</span>
                    <span className="modal-model-id">{m.id}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="modal-custom-section">
            <label className="modal-model-option">
              <input
                type="radio"
                name="ai-model"
                checked={isCustom}
                onChange={() => setIsCustom(true)}
              />
              <span className="modal-model-info">
                <span className="modal-model-name">Своя модель</span>
                <span className="modal-model-id">ID из OpenRouter</span>
              </span>
            </label>
            {isCustom && (
              <input
                className="modal-custom-input"
                type="text"
                placeholder="openai/gpt-4o"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                autoFocus
              />
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}
