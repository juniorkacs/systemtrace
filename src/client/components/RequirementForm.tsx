import { useState, type FormEvent } from "react";
import {
  PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  VERIFICATION_METHODS,
  requirementInput,
  type Requirement,
  type RequirementInput,
} from "../../shared/schema.ts";
import { Button, ErrorBanner, Field, inputCls } from "./ui.tsx";

type Props = {
  initial?: Requirement;
  parents: { id: string; title: string }[];
  submitLabel: string;
  onSubmit: (value: RequirementInput) => Promise<void>;
  onCancel?: () => void;
};

const blank: RequirementInput = {
  id: "",
  title: "",
  description: "",
  type: "functional",
  priority: "medium",
  status: "draft",
  verificationMethod: "test",
  parentId: null,
  rationale: "",
};

/** Create/edit form. Validates with the same schema the API uses before sending. */
export function RequirementForm({ initial, parents, submitLabel, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState<RequirementInput>(initial ? { ...blank, ...initial } : blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RequirementInput>(k: K, v: RequirementInput[K]) => setValue((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const parsed = requirementInput.safeParse(value);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setServerError(err as Error);
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`req-${k}-error`} className="mt-1 text-xs text-bad">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {serverError ? <ErrorBanner error={serverError} /> : null}
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="ID" htmlFor="req-id">
          <input
            id="req-id"
            className={inputCls}
            value={value.id}
            disabled={!!initial}
            placeholder="NAV-004"
            aria-invalid={!!errors.id}
            aria-describedby={errors.id ? "req-id-error" : undefined}
            onChange={(e) => set("id", e.target.value.toUpperCase())}
          />
          {err("id")}
        </Field>
        <Field label="Title" htmlFor="req-title">
          <input
            id="req-title"
            className={inputCls}
            value={value.title}
            placeholder="What the system shall do, in one line"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "req-title-error" : undefined}
            onChange={(e) => set("title", e.target.value)}
          />
          {err("title")}
        </Field>
      </div>
      <Field label="Description" htmlFor="req-description">
        <textarea id="req-description" rows={3} className={inputCls} value={value.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select id="req-type" label="Type" value={value.type} options={REQUIREMENT_TYPES} onChange={(v) => set("type", v)} />
        <Select id="req-priority" label="Priority" value={value.priority} options={PRIORITIES} onChange={(v) => set("priority", v)} />
        <Select id="req-status" label="Status" value={value.status} options={REQUIREMENT_STATUSES} onChange={(v) => set("status", v)} />
        <Select
          id="req-method"
          label="Verification method"
          value={value.verificationMethod}
          options={VERIFICATION_METHODS}
          onChange={(v) => set("verificationMethod", v)}
        />
      </div>
      <Field label="Parent requirement" htmlFor="req-parent">
        <select id="req-parent" className={inputCls} value={value.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}>
          <option value="">None (top-level requirement)</option>
          {parents
            .filter((p) => p.id !== value.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}: {p.title}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Rationale" htmlFor="req-rationale" hint="Why this requirement exists. Reviewers use this to judge changes.">
        <textarea id="req-rationale" rows={2} className={inputCls} value={value.rationale} onChange={(e) => set("rationale", e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Select<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}
