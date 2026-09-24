'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional title rendered at the top of the modal */
  title?: string;
  /** Overrides the translated close-button label. */
  closeLabel?: string;
}

/** CSS selector that matches all natively focusable elements. */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'details',
  'embed',
  'iframe',
  'input:not([disabled])',
  'object',
  'select:not([disabled])',
  'summary',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
  ).filter((el) => !el.closest('[inert]') && el.tabIndex !== -1);
}

export default function Modal({
  isOpen,
  onClose,
  children,
  title,
  closeLabel,
}: ModalProps) {
  const t = useTranslations('common');
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to the element that triggered the modal so we can
  // restore focus when the modal closes.
  const triggerRef = useRef<Element | null>(null);

  // ── Focus management ───────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      // Capture the currently focused element before we move focus inside.
      triggerRef.current = document.activeElement;

      // Move focus to the first focusable element inside the modal on the
      // next tick (after the DOM has been painted).
      const frame = requestAnimationFrame(() => {
        if (!dialogRef.current) return;
        const focusable = getFocusable(dialogRef.current);
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          // Fall back to the dialog container itself if nothing is focusable.
          dialogRef.current.focus();
        }
      });

      return () => cancelAnimationFrame(frame);
    } else {
      // Restore focus to the trigger element when the modal closes.
      const trigger = triggerRef.current;
      if (trigger && typeof (trigger as HTMLElement).focus === 'function') {
        requestAnimationFrame(() => (trigger as HTMLElement).focus());
      }
      triggerRef.current = null;
    }
  }, [isOpen]);

  // ── Keyboard handling ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Escape: close and return focus to trigger.
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Tab / Shift+Tab: cycle focus only within the modal.
      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = getFocusable(dialogRef.current);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          // Shift+Tab: if focus is on or before the first element, wrap to last.
          if (
            document.activeElement === first ||
            !dialogRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab: if focus is on or after the last element, wrap to first.
          if (
            document.activeElement === last ||
            !dialogRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        // tabIndex="-1" lets the container receive programmatic focus when
        // no focusable children are present.
        tabIndex={-1}
        className="relative bg-brand-card border border-gray-300 dark:border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={closeLabel ?? t('close_modal')}
          className="absolute top-3 right-3 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
          onClick={onClose}
        >
          ✕
        </button>
        {title && (
          <h2
            id={titleId}
            className="text-lg font-semibold text-gray-900 dark:text-white mb-4"
          >
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

/** Convenience hook for managing modal open/close state */
export function useModal(initial = false) {
  const [isOpen, setIsOpen] = useState(initial);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  return { isOpen, open, close, toggle };
}
