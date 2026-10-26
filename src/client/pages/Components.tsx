import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api.ts";
import { COMPONENT_KINDS, componentInput, type ComponentInput } from "../../shared/schema.ts";
import { Button, ErrorBanner, Field, Loading, PageHeader, Panel, Tag, inputCls, useAsync } from "../components/ui.tsx";

export function Components() {
  const list = useAsync(() => api.components(), []);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      list.reload();
    } catch (e) {
      setError(e as Error);
    }
  }

  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorBanner error={list.error} onRetry={list.reload} />;
  const comps = list.data!;
  const depth = (id: string | null, d = 0): number => {
    const c = comps.find((x) => x.id === id);
    return c?.parentId && d < 8 ? depth(c.parentId, d + 1) : d;
  };
  // Show the physical hierarchy: each component right after its parent.
  const ordered: typeof comps = [];
  const visit = (parent: string | null) => {
    for (const c of comps.filter((x) => x.parentId === parent)) {
      ordered.push(c);
      visit(c.id);
    }
  };
  visit(null);

  return (
    <>
      <PageHeader
        title="Components and interfaces"
        description="The system breakdown that requirements are allocated to. A component that satisfies no requirement may be unneeded scope."
        actions={
          !creating ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden /> New component
            </Button>
          ) : null
        }
      />
      {error ? (
        <div className="mb-4">
          <ErrorBanner error={error} />
        </div>
      ) : null}
      {creating ? (
        <Panel title="New component" className="mb-6">
          <ComponentForm
            parents={comps}
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              await api.createComponent(v);
              setCreating(false);
              list.reload();
            }}
          />
        </Panel>
      ) : null}
      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">Components</caption>
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-normal">ID and name</th>
              <th scope="col" className="px-3 py-2 font-normal">Kind</th>
              <th scope="col" className="px-3 py-2 font-normal">Satisfies</th>
              <th scope="col" className="px-3 py-2 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-raised">
            {ordered.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  <span style={{ paddingLeft: `${depth(c.id) * 1.25}rem` }} className="inline-block">
                    <span className="type-condensed text-ink">{c.id}</span> <span className="text-muted">{c.name}</span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Tag tone={c.kind === "interface" ? "info" : "muted"}>{c.kind}</Tag>
                </td>
                <td className="px-3 py-2">
                  {c.requirementIds.length ? (
                    <span className="flex flex-wrap gap-x-2">
                      {c.requirementIds.map((r) => (
                        <Link key={r} to={`/requirements/${r}`} className="text-accent hover:underline">
                          {r}
                        </Link>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">none directly</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${c.id}`}
                    onClick={() => window.confirm(`Delete ${c.id} and its trace links?`) && act(() => api.deleteComponent(c.id))}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ComponentForm({
  parents,
  onSubmit,
  onCancel,
}: {
  parents: { id: string; name: string }[];
  onSubmit: (v: ComponentInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<ComponentInput>({ id: "", name: "", kind: "component", description: "", parentId: null });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = componentInput.safeParse(v);
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join(" "));
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {error ? (
        <p role="alert" className="text-sm text-bad sm:col-span-2 lg:col-span-4">
          {error}
        </p>
      ) : null}
      <Field label="ID" htmlFor="c-id">
        <input id="c-id" className={inputCls} placeholder="CMP-BATT" value={v.id} onChange={(e) => setV({ ...v, id: e.target.value.toUpperCase() })} />
      </Field>
      <Field label="Name" htmlFor="c-name">
        <input id="c-name" className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label="Kind" htmlFor="c-kind">
        <select id="c-kind" className={inputCls} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as ComponentInput["kind"] })}>
          {COMPONENT_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Part of" htmlFor="c-parent">
        <select id="c-parent" className={inputCls} value={v.parentId ?? ""} onChange={(e) => setV({ ...v, parentId: e.target.value || null })}>
          <option value="">None</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}: {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary">
          Create component
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
