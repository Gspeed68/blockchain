import type { ReactNode } from "react";
import "./StateViews.css";

export function LoadingView({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state-view state-view--loading" role="status" aria-live="polite">
      <span className="state-view__spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-view state-view--error" role="alert">
      <p className="state-view__title">Something went wrong</p>
      <p className="state-view__message">{message}</p>
      {onRetry && (
        <button className="btn btn--secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyView({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="state-view state-view--empty">
      <p className="state-view__title">{title}</p>
      <p className="state-view__message">{message}</p>
      {action}
    </div>
  );
}
