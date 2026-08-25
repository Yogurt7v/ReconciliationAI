import { AlertIcon } from './icons';

interface Props {
  message: string | null;
  variant?: 'error' | 'warn' | 'info';
}

export default function ErrorBanner({ message, variant = 'error' }: Props) {
  if (!message) return null;
  return (
    <div className={`banner banner-${variant}`} role="alert">
      <AlertIcon />
      <span>{message}</span>
    </div>
  );
}
