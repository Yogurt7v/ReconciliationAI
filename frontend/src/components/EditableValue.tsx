import { useState } from 'react';

interface EditableValueProps {
  value: number;
  onChange: (v: number) => void;
  mono?: boolean;
}

export function EditableValue({ value, onChange, mono = true }: EditableValueProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(draft.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isNaN(parsed)) {
      onChange(parsed);
    } else {
      setDraft(String(value));
    }
  };

  if (editing) {
    return (
      <input
        className="editable-input"
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setEditing(false);
            setDraft(String(value));
          }
        }}
        style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}
      />
    );
  }

  const fmt = (val: number | null): string => {
    if (val === null) return '---';
    return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <span
      className="editable-value"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}
    >
      {fmt(value)}
    </span>
  );
}
