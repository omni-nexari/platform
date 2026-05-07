import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type CalloutTone = 'accent' | 'warning' | 'danger';

export function PageHeader({
  icon,
  title,
  subtitle,
  description,
  action,
  actions,
  trailing,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const resolvedSubtitle = subtitle ?? description;
  const resolvedAction = action ?? actions;

  return (
    <div className={joinClasses('mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon ? <div className="mt-1 shrink-0 text-[var(--text-muted)]">{icon}</div> : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-[var(--text)]">{title}</h1>
          {resolvedSubtitle ? <p className="mt-1 text-sm text-[var(--text-muted)]">{resolvedSubtitle}</p> : null}
        </div>
      </div>
      {(trailing || resolvedAction) ? (
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end lg:shrink-0">
          {trailing}
          {resolvedAction}
        </div>
      ) : null}
    </div>
  );
}

export function FilterChip({
  active = false,
  tone = 'default',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <button
      {...props}
      className={joinClasses(
        'ui-filter-chip',
        active && 'ui-filter-chip-active',
        !active && tone === 'warning' && 'ui-filter-chip-warning',
        !active && tone === 'danger' && 'ui-filter-chip-danger',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function StatChip({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={joinClasses('ui-stat-chip', className)}>
      {children}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
}) {
  const toneClass = tone === 'info' ? 'accent' : tone;

  return (
    <span {...props} className={joinClasses('ui-badge', `ui-badge-${toneClass}`, className)}>
      {children}
    </span>
  );
}

export function Callout({
  tone = 'accent',
  icon,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: CalloutTone;
  icon?: ReactNode;
}) {
  return (
    <div {...props} className={joinClasses('ui-callout', `ui-callout-${tone}`, className)}>
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ToggleSwitch({
  label,
  checked,
  onChange,
  className,
  labelClassName,
}: {
  label?: ReactNode;
  checked: boolean;
  onChange: () => void;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <label className={joinClasses('ui-switch-row', className)}>
      {label ? <span className={joinClasses('ui-switch-label', labelClassName)}>{label}</span> : null}
      <div onClick={onChange} className={joinClasses('ui-switch', checked && 'ui-switch-on')}>
        <div className={joinClasses('ui-switch-thumb', checked && 'ui-switch-thumb-on')} />
      </div>
    </label>
  );
}

export function Modal({
  children,
  open = true,
  onClose,
  size = 'sm',
  className,
}: {
  children: ReactNode;
  open?: boolean;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (!open) return null;

  const sizeClass = size === 'lg' ? 'modal-shell-lg' : size === 'md' ? 'modal-shell-md' : 'modal-shell-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className={joinClasses('modal-shell', sizeClass, className)}>{children}</div>
    </div>
  );
}

export function ModalHeader({
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const resolvedTitle = title ?? children;
  const trailingContent = title ? children : null;

  return (
    <div className="modal-header">
      <div className="flex items-center gap-3 min-w-0">
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="min-w-0">
          {resolvedTitle ? <h2 className="modal-title">{resolvedTitle}</h2> : null}
          {subtitle ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p> : null}
        </div>
      </div>
      {trailingContent ?? (onClose ? (
        <button onClick={onClose} className="modal-close">
          <X size={18} />
        </button>
      ) : null)}
    </div>
  );
}

export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={joinClasses('modal-body', className)}>{children}</div>;
}

export function ModalFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={joinClasses('modal-footer', className)}>{children}</div>;
}

export function ModalPrimaryButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={joinClasses('modal-primary-btn', className)}>
      {children}
    </button>
  );
}

export function ModalSecondaryButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={joinClasses('modal-secondary-btn', className)}>
      {children}
    </button>
  );
}

export function ActionButton({
  tone = 'default',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
}) {
  return (
    <button
      {...props}
      className={joinClasses(
        'detail-action-btn',
        tone === 'primary' && 'detail-action-btn-primary',
        tone === 'success' && 'detail-action-btn-success',
        tone === 'warning' && 'detail-action-btn-warning',
        tone === 'danger' && 'detail-action-btn-danger',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  subtitle,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const resolvedDescription = description ?? subtitle;

  return (
    <div className={joinClasses('ui-empty-state', className)}>
      {icon ? <div className="ui-empty-state-icon">{icon}</div> : null}
      <div className="space-y-1">
        <p className="ui-empty-state-title">{title}</p>
        {resolvedDescription ? <p className="ui-empty-state-description">{resolvedDescription}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function InlineActionButton({
  tone = 'default',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      {...props}
      className={joinClasses(
        'ui-inline-action-btn',
        tone === 'danger' && 'ui-inline-action-btn-danger',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SectionCard({ className, children, style, onClick }: { className?: string; children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return <section className={joinClasses('ui-section-card', className)} style={style} onClick={onClick}>{children}</section>;
}

export function SectionCardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={joinClasses('ui-section-card-header', className)}>{children}</div>;
}

export function SectionCardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={joinClasses('ui-section-card-body', className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={joinClasses('animate-pulse rounded-lg bg-[var(--surface)]', className)} />;
}