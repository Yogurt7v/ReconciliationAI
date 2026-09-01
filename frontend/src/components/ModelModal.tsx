import { useEffect, useRef, useState } from 'react';

import { AI_MODELS, DEFAULT_MODEL } from '../config';
import { XIcon } from './icons';

interface Props {
  open: boolean;
  model: string;
  onClose: () => void;
  onSave: (model: string) => void;
}

export function ModelModal({ open, model, onClose, onSave }: Props) {
  const [selected, setSelected] = useState(model);
  const [customValue, setCustomValue] = useState('');
  const [isCustom, setIsCustom] = useState(false);
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
    }
  }, [open, model]);

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
    if (isCustom) {
      onSave(customValue.trim() || DEFAULT_MODEL);
    } else {
      onSave(selected || DEFAULT_MODEL);
    }
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-panel" role="dialog" aria-label="Выбор модели ИИ">
        <div className="modal-header">
          <h3 className="modal-title">Модель ИИ</h3>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {AI_MODELS.length > 0 && (
            <div className="modal-model-list">
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
