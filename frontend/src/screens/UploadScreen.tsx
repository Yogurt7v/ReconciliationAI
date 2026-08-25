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

  const canSubmit = Boolean(ours.file && partner.file && !busy);

  const submit = useCallback(async () => {
    if (!ours.file || !partner.file) return;
    setBusy(true);
    onError(null);
    try {
      const { id } = await api.upload(ours.file, partner.file);
      onUploaded(id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Не удалось загрузить файлы');
      setBusy(false);
    }
  }, [ours.file, partner.file, onUploaded, onError]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Файлы для сверки</h2>
      </div>

      <div className="ledger-spread">
        <div className="ledger-side">
          <div className="ledger-eyebrow">Ваш акт</div>
          <Dropzone label="Ваш акт сверки" slot={ours} inputRef={oursRef} onPick={pick('ours')} />
        </div>

        <div className="ledger-spine" aria-hidden="true" />

        <div className="ledger-side">
          <div className="ledger-eyebrow">Акт контрагента</div>
          <Dropzone label="Акт контрагента" slot={partner} inputRef={partnerRef} onPick={pick('partner')} />
        </div>
      </div>

      <div className="upload-actions">
        <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Загрузка…' : 'Сверить документы'}
        </button>
        <span className="muted">XLSX или PDF, до {MAX_MB} МБ</span>
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
