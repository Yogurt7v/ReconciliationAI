import { useState } from 'react';

interface EditableTextProps {
  value: string;
  onChange: (v: string) => void;
}

export function EditableText({ value, onChange }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft.trim()) {
      onChange(draft.trim());
    } else {
      setDraft(value);
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
            setDraft(value);
          }
        }}
      />
    );
  }

  return (
    <span
      className="editable-value"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
