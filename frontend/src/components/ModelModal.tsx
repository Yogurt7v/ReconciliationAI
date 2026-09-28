import { useEffect, useRef, useState } from 'react';

import { AI_MODELS, DEFAULT_MODEL, API_KEY_STORAGE_KEY, LOCAL_MODEL_PRESETS } from '../config';
import type { AiRuntimeInfo } from '../api';
import { XIcon } from './icons';

interface Props {
  open: boolean;
  model: string;
  apiKey: string;
  /** Фактическая конфигурация backend (null, если недоступна) */
  runtime?: AiRuntimeInfo | null;
  onClose: () => void;
  onSave: (model: string, apiKey: string) => void;
}

export function ModelModal({ open, model, apiKey, runtime, onClose, onSave }: Props) {
  const [selected, setSelected] = useState(model);
  const [customValue, setCustomValue] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(apiKey);
  const overlayRef = useRef<HTMLDivElement>(null);

  // REQUIRE_LOCAL_ONLY: облачные модели и ключ OpenRouter не применяются.
  const localOnly = runtime?.localOnly === true;
  const cloudModels = AI_MODELS.filter((m) => m.provider !== 'local');
  const localModels = AI_MODELS.filter((m) => m.provider === 'local');
  // Если модель из localStorage не применима, показываем реальную.
  const effectiveModel = localOnly ? (runtime?.model ?? model) : model;

  useEffect(() => {
    if (!open) return;
    // В локальном режиме инициализируемся реально применяемой моделью, а не
    // сохранённой: облачный ID из localStorage здесь всё равно был бы отброшен,
    // но остался бы «выбранным» и снова записался бы при сохранении.
    const target = effectiveModel;
    const isPreset = AI_MODELS.some((m) => m.id === target);
    if (isPreset) {
      setSelected(target);
      setIsCustom(false);
      setCustomValue('');
    } else {
      setSelected('');
      setIsCustom(true);
      setCustomValue(target === DEFAULT_MODEL ? '' : target);
    }
    setApiKeyValue(apiKey || '');
  }, [open, effectiveModel, apiKey]);

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
    // В локальном режиме запасной вариант — реальная модель backend'а,
    // а не облачный DEFAULT_MODEL (который всё равно был бы отброшен).
    const fallback = localOnly ? (runtime?.model ?? DEFAULT_MODEL) : DEFAULT_MODEL;
    let finalModel: string;
    if (isCustom) {
      finalModel = customValue.trim() || fallback;
    } else {
      finalModel = selected || fallback;
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
          {/* Статус фактической конфигурации — снимает путаницу, когда выбранная
              модель отличается от применяемой backend'ом. */}
          {runtime && (
            <div className="modal-hint" role="status">
              {localOnly ? 'Режим «только локально»: облачные модели и ключ OpenRouter не используются. ' : ''}
              Фактически применяется: <code>{runtime.model}</code>
              {runtime.provider === 'ollama' ? ' (Ollama)' : ' (OpenRouter)'}.
            </div>
          )}

          {/* API Key Section */}
          {!localOnly && (
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
                . Не требуется для локальных моделей (Ollama).
              </p>
            </div>
          )}

          {/* Model Selection: grouped by provider */}
          {!localOnly && cloudModels.length > 0 && (
            <div className="modal-model-list">
              <p className="modal-label">Облачные модели (OpenRouter):</p>
              {cloudModels.map((m) => (
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

          {localModels.length > 0 && (
            <div className="modal-model-list">
              <p className="modal-label">Локальные модели (Ollama):</p>
              {localModels.map((m) => (
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
              <p className="modal-hint">
                Требуют запущенного backend с <code>AI_PROVIDER=ollama</code>. Данные не покидают ваш компьютер.
              </p>
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
                <span className="modal-model-id">
                  {localOnly ? 'Имя модели Ollama (например qwen2.5:7b-instruct)' : 'ID из OpenRouter или имя модели Ollama'}
                </span>
              </span>
            </label>
            {isCustom && (
              <input
                className="modal-custom-input"
                type="text"
                list="model-presets"
                placeholder={localOnly ? 'qwen2.5:7b-instruct' : 'openai/gpt-4o или qwen2.5:7b-instruct'}
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                autoFocus
              />
            )}
            <datalist id="model-presets">
              {LOCAL_MODEL_PRESETS.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
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
