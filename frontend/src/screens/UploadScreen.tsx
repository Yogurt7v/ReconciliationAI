import { useCallback, useRef, useState } from 'react';

import { MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { api } from '../api';
import { UploadCloudIcon, FileIcon } from '../components/icons';

const ACCEPT = '.xlsx,.pdf';
const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

interface Props {
  onUploaded: (jobId: string) => void;
  onError: (message: string | null) => void;
}

interface Slot {
  file: File | null;
}

export default function UploadScreen({ onUploaded, onError }: Props) {
  const [ours, setOurs] = useState<Slot>({ file: null });
  const [partner, setPartner] = useState<Slot>({ file: null });
  const [twoSided, setTwoSided] = useState(false);
  const [busy, setBusy] = useState(false);
  const oursRef = useRef<HTMLInputElement>(null);
  const partnerRef = useRef<HTMLInputElement>(null);

  const validate = (file: File): string | null => {
    if (!/\.(xlsx|pdf)$/i.test(file.name)) return 'Поддерживаются только XLSX и PDF.';
    if (file.size > MAX_FILE_SIZE_BYTES) return `Файл больше ${MAX_MB} МБ.`;
    return null;
  };

  const pick = (side: 'ours' | 'partner') => (file: File) => {
    const problem = validate(file);
    if (problem) {
      onError(problem);
      return;
    }
    onError(null);
    if (side === 'ours') setOurs({ file });
    else setPartner({ file });
  };

  const canSubmit = twoSided
    ? Boolean(ours.file && !busy)
    : Boolean(ours.file && partner.file && !busy);

  const submit = useCallback(async () => {
    if (!ours.file) return;
    if (!twoSided && !partner.file) return;
    setBusy(true);
    onError(null);
    try {
      const { id } = await api.upload(ours.file, partner.file ?? null, twoSided);
      onUploaded(id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Не удалось загрузить файлы');
      setBusy(false);
    }
  }, [ours.file, partner.file, twoSided, onUploaded, onError]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Файлы для сверки</h2>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={twoSided}
          onChange={(e) => {
            setTwoSided(e.target.checked);
            if (e.target.checked) setPartner({ file: null });
          }}
          style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
        />
        <span>Двусторонний акт (данные обеих сторон в одном PDF)</span>
      </label>

      <div className="ledger-spread">

        <div className="ledger-side">
          <div className="ledger-eyebrow">Акт контрагента</div>
          {twoSided ? (
            <p className="muted" style={{ fontSize: 'var(--text-sm)', padding: 'var(--sp-3) 0' }}>
              Данные контрагента будут извлечены из вашего файла автоматически.
            </p>
          ) : (
            <Dropzone label="Акт контрагента" slot={partner} inputRef={partnerRef} onPick={pick('partner')} />
          )}
        </div>

        <div className="ledger-spine" aria-hidden="true" />

        <div className="ledger-side">
          <div className="ledger-eyebrow">Ваш акт</div>
          <Dropzone label="Ваш акт сверки" slot={ours} inputRef={oursRef} onPick={pick('ours')} />
        </div>

      </div>

      <div className="upload-actions">
        <span className="muted">
          {twoSided ? 'PDF двустороннего акта, до ' : 'XLSX или PDF, до '}{MAX_MB} МБ
        </span>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Загрузка…' : 'Сверить документы'}
        </button>
      </div>
    </div>
  );
}

interface DropzoneProps {
  label: string;
  slot: Slot;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}

function Dropzone({ label, slot, inputRef, onPick }: DropzoneProps) {
  const [over, setOver] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onPick(file);
  };

  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${slot.file ? 'filled' : ''}`}
      onClick={openPicker}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && openPicker()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
      {slot.file ? (
        <>
          <FileIcon className="dropzone-icon" />
          <div className="dropzone-file">{slot.file.name}</div>
        </>
      ) : (
        <>
          <UploadCloudIcon className="dropzone-icon" />
          <div className="dropzone-label">{label}</div>
          <div className="dropzone-hint">Перетащите файл сюда или нажмите</div>
        </>
      )}
    </div>
  );
}
