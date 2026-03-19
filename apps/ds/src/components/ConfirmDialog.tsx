import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

type ConfirmDialogVariant = 'danger' | 'warning' | 'primary' | 'info';

const VARIANT_STYLES: Record<ConfirmDialogVariant, {
  accent: string;
  iconWrap: string;
  iconColor: string;
  titleColor: string;
  confirmButton: string;
  panelGlow: string;
  defaultIcon: ReactNode;
}> = {
  danger: {
    accent: '#ef4444',
    iconWrap: 'bg-red-500/15',
    iconColor: 'text-red-400',
    titleColor: 'text-red-300',
    confirmButton: 'bg-red-500 text-white',
    panelGlow: '0 24px 60px rgba(239, 68, 68, 0.12)',
    defaultIcon: <AlertTriangle size={16} />,
  },
  warning: {
    accent: '#f59e0b',
    iconWrap: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    titleColor: 'text-amber-300',
    confirmButton: 'bg-amber-500 text-white',
    panelGlow: '0 24px 60px rgba(245, 158, 11, 0.12)',
    defaultIcon: <AlertTriangle size={16} />,
  },
  primary: {
    accent: 'var(--accent)',
    iconWrap: 'bg-[var(--accent)]/15',
    iconColor: 'text-[var(--accent)]',
    titleColor: 'text-[var(--text)]',
    confirmButton: 'bg-[var(--accent)] text-white',
    panelGlow: '0 24px 60px rgba(58, 123, 255, 0.14)',
    defaultIcon: <Info size={16} />,
  },
  info: {
    accent: '#38bdf8',
    iconWrap: 'bg-sky-500/15',
    iconColor: 'text-sky-400',
    titleColor: 'text-sky-300',
    confirmButton: 'bg-sky-500 text-white',
    panelGlow: '0 24px 60px rgba(56, 189, 248, 0.14)',
    defaultIcon: <Info size={16} />,
  },
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmPendingLabel?: string;
  variant?: ConfirmDialogVariant;
  icon?: ReactNode;
  isConfirming?: boolean;
  closeOnConfirm?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  confirmPendingLabel = 'Working…',
  variant = 'danger',
  icon,
  isConfirming = false,
  closeOnConfirm = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const styles = VARIANT_STYLES[variant];
  const dialogIcon = icon ?? styles.defaultIcon;
  const titleId = useId();
  const messageId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  function handleClose() {
    if (isConfirming) return;
    onClose();
  }

  function handleConfirm() {
    if (isConfirming) return;
    onConfirm();
    if (closeOnConfirm) onClose();
  }

  useEffect(() => {
    if (!open) return;

    cancelButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInteractive = !!tag && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag);

      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !isInteractive && !isConfirming) {
        event.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isConfirming]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/75"
        style={{ animation: 'confirm-dialog-backdrop-in 160ms ease-out' }}
        onClick={handleClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="relative w-full max-w-sm rounded-2xl p-6 space-y-4 overflow-hidden"
        style={{
          background: 'var(--modal-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: styles.panelGlow,
          animation: 'confirm-dialog-panel-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: `linear-gradient(90deg, ${styles.accent}, transparent 72%)` }}
        />

        {/* Icon + title */}
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${styles.iconWrap}`}>
            <div className={styles.iconColor}>{dialogIcon}</div>
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className={`text-base font-bold ${styles.titleColor}`}>{title}</h2>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)] mt-0.5">Confirm action</p>
          </div>
        </div>

        <p id={messageId} className="text-sm text-[var(--text-muted)] leading-relaxed">{message}</p>

        <div className="flex gap-2 pt-1">
          <button
            ref={cancelButtonRef}
            onClick={handleClose}
            disabled={isConfirming}
            className="flex-1 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed ${styles.confirmButton}`}
          >
            {isConfirming && (
              <span
                aria-hidden="true"
                className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/35 border-t-white"
                style={{ animation: 'confirm-dialog-spinner 700ms linear infinite' }}
              />
            )}
            <span>{isConfirming ? confirmPendingLabel : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
