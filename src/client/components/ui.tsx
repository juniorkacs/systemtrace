import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ApiError } from "../api.ts";
import type { VerificationState } from "../../shared/trace.ts";

/**
 * Loads data, tracks loading/error state, and exposes reload().
 * `deps` are serialised, so pass primitive values (IDs, filter strings).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const key = JSON.stringify(deps);
  useEffect(() => {
    let live = true;
    fnRef.current().then(
      (data) => live && setState({ data, loading: false }),
      (error: Error) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="type-display text-2xl text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, children, className = "", actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`border border-line bg-raised ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="type-condensed text-ink">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" };
export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  const styles = {
    primary: "bg-accent text-accent-ink font-semibold hover:opacity-90",
    secondary: "border border-line-strong text-ink hover:border-accent",
    danger: "border border-bad/60 text-bad hover:bg-bad/10",
    ghost: "text-muted hover:text-ink",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const fields = error instanceof ApiError ? error.fieldErrors : [];
  return (
    <div role="alert" className="flex items-start gap-3 border border-bad/50 bg-bad/10 px-4 py-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
      <div className="flex-1">
        <p className="text-ink">{error.message}</p>
        {fields.length ? (
          <ul className="mt-1 list-disc pl-5 text-muted">
            {fields.slice(0, 12).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
        {error instanceof TypeError ? (
          <p className="mt-1 text-muted">The API did not respond. Check that the server is running on port 3001.</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

const STATE_STYLE: Record<VerificationState, { label: string; cls: string }> = {
  passed: { label: "Passed", cls: "border-ok/50 text-ok" },
  planned: { label: "Planned", cls: "border-info/50 text-info" },
  unverified: { label: "No test", cls: "border-warn/50 text-warn" },
  blocked: { label: "Blocked", cls: "border-warn/50 text-warn" },
  failing: { label: "Failing", cls: "border-bad/60 text-bad" },
};

export const STATE_COLOR: Record<VerificationState, string> = {
  passed: "var(--ok)",
  planned: "var(--info)",
  unverified: "var(--warn)",
  blocked: "#c98a2b",
  failing: "var(--bad)",
};

export function StateBadge({ state }: { state: VerificationState }) {
  const s = STATE_STYLE[state];
  return <span className={`inline-block border px-1.5 py-px text-xs whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "bad" | "info" }) {
  const cls = {
    muted: "border-line text-muted",
    ok: "border-ok/50 text-ok",
    warn: "border-warn/50 text-warn",
    bad: "border-bad/60 text-bad",
    info: "border-info/50 text-info",
  }[tone];
  return <span className={`inline-block border px-1.5 py-px text-xs whitespace-nowrap ${cls}`}>{children}</span>;
}

export function TestStatusTag({ status }: { status: string }) {
  const tone = status === "passed" ? "ok" : status === "failed" ? "bad" : status === "blocked" ? "warn" : "info";
  return <Tag tone={tone}>{status}</Tag>;
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputCls =
  "w-full border border-line bg-sunken px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
