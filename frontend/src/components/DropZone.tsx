import type { RefObject } from 'react';

import { FileIcon, UploadCloudIcon } from './icons';

const ACCEPT = '.xlsx,.xls,.pdf';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

interface DropZoneProps {
  label: string;
  file: File | null;
  busy: boolean;
  over: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (f: File) => void;
  onOver: (v: boolean) => void;
}

export function DropZone({
  label,
  file,
  busy,
  over,
  inputRef,
  onPick,
  onOver,
}: DropZoneProps) {
  const openPicker = () => inputRef.current?.click();

  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${file ? 'filled' : ''}`}
      onClick={openPicker}
      onDragOver={(e) => { e.preventDefault(); onOver(true); }}
      onDragLeave={() => onOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        onOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onPick(f);
      }}
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
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      {file ? (
        <>
          <FileIcon className="dropzone-icon" />
          <div className="dropzone-file">{file.name}</div>
          <div className="dropzone-hint">
            {busy ? 'Анализ...' : `${formatFileSize(file.size)} · Нажмите или перетащите другой`}
          </div>
        </>
      ) : (
        <>
          <UploadCloudIcon className="dropzone-icon" />
          <div className="dropzone-label">{label}</div>
          <div className="dropzone-hint">Перетащите файл или нажмите</div>
        </>
      )}
    </div>
  );
}
