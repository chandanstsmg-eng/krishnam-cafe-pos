import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { t } from '../../i18n';

/**
 * Modal built on the native <dialog> element: focus is trapped, Esc closes,
 * and screen readers announce it as a dialog without extra libraries.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  dismissible?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() moves focus to the close button; put it where people type instead:
      // the field marked autofocus, else the first field, else the first footer button.
      const target =
        d.querySelector<HTMLElement>('[data-autofocus]') ??
        d.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
        d.querySelector<HTMLElement>('[data-dialog-footer] button:not([disabled])');
      if (target) target.focus();
      else d.focus(); // not the close button, or Enter would close it
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissible) closeRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [dismissible]);

  if (!open) return <dialog ref={ref} className="hidden" />;

  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? 'dlg-title' : undefined}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
      className={cn(
        'animate-pop m-auto focus:outline-none max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-pop',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-lg',
        size === 'lg' && 'max-w-2xl',
        size === 'xl' && 'max-w-4xl',
        size === 'full' && 'max-w-6xl',
        className,
      )}
    >
      <div className="flex max-h-[calc(100dvh-24px)] flex-col">
        {title && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id="dlg-title" className="text-[17px] font-semibold leading-snug">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} aria-label={t('common.close')} className="-m-1.5 rounded-md p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>{children}</div>
        {footer && <div data-dialog-footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/60 px-5 py-3">{footer}</div>}
      </div>
    </dialog>
  );
}
