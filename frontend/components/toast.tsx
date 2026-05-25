"use client";

import { useEffect } from "react";

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
  autoDismissMs?: number;
};

export function Toast({ message, onDismiss, autoDismissMs = 4000 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [message, autoDismissMs, onDismiss]);

  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {message ? (
        <div className="toast" key={message}>
          <span className="toast-dot" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="14" height="14" focusable="false" aria-hidden="true">
              <path fill="currentColor" d="M7.5 13.2 4.3 10l-1.4 1.4 4.6 4.6 10-10-1.4-1.4z" />
            </svg>
          </span>
          <span>{message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
