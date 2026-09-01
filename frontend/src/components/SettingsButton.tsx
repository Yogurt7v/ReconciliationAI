import { GearIcon } from './icons';

interface Props {
  onClick: () => void;
}

export function SettingsButton({ onClick }: Props) {
  return (
    <button className="settings-fab" onClick={onClick} aria-label="Настройки модели ИИ">
      <GearIcon />
    </button>
  );
}
