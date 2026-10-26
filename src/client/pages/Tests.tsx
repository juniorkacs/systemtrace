import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api.ts";
import { TEST_STATUSES, VERIFICATION_METHODS, testInput, type TestInput } from "../../shared/schema.ts";
import { Button, ErrorBanner, Field, Loading, PageHeader, Panel, inputCls, useAsync } from "../components/ui.tsx";

export function Tests() {
  const list = useAsync(() => api.tests(), []);
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

  return (
    <>
      <PageHeader
        title="Verification tests"
        description="Tests, analyses, inspections and demonstrations. Change a result here and coverage updates everywhere."
        actions={
          !creating ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden /> New test
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
        <Panel title="New verification test" className="mb-6">
          <TestForm
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              await api.createTest(v);
              setCreating(false);
              list.reload();
            }}
          />
        </Panel>
      ) : null}
      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">Verification tests</caption>
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-normal">ID and name</th>
              <th scope="col" className="px-3 py-2 font-normal">Method</th>
              <th scope="col" className="px-3 py-2 font-normal">Result</th>
              <th scope="col" className="px-3 py-2 font-normal">Last run</th>
              <th scope="col" className="px-3 py-2 font-normal">Verifies</th>
              <th scope="col" className="px-3 py-2 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-raised">
            {list.data!.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">
                  <span className="type-condensed text-ink">{t.id}</span> <span className="text-muted">{t.name}</span>
                  {t.description ? <p className="text-xs text-muted">{t.description}</p> : null}
                </td>
                <td className="px-3 py-2 text-muted">{t.method}</td>
                <td className="px-3 py-2">
                  <label htmlFor={`status-${t.id}`} className="sr-only">
                    Result of {t.id}
                  </label>
                  <select
                    id={`status-${t.id}`}
                    value={t.status}
                    onChange={(e) =>
                      act(() =>
                        api.updateTest(t.id, {
                          status: e.target.value as TestInput["status"],
                          lastRun: e.target.value === "passed" || e.target.value === "failed" ? new Date().toISOString().slice(0, 10) : t.lastRun,
                        }),
                      )
                    }
                    className={`${inputCls} w-28 py-1 ${t.status === "passed" ? "text-ok" : t.status === "failed" ? "text-bad" : t.status === "blocked" ? "text-warn" : "text-info"}`}
                  >
                    {TEST_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="tabular px-3 py-2 text-muted">{t.lastRun ?? "not run"}</td>
                <td className="px-3 py-2">
                  {t.requirementIds.length ? (
                    <span className="flex flex-wrap gap-x-2">
                      {t.requirementIds.map((r) => (
                        <Link key={r} to={`/requirements/${r}`} className="text-accent hover:underline">
                          {r}
                        </Link>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-warn">nothing</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${t.id}`}
                    onClick={() => window.confirm(`Delete ${t.id} and its trace links?`) && act(() => api.deleteTest(t.id))}
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

function TestForm({ onSubmit, onCancel }: { onSubmit: (v: TestInput) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<TestInput>({ id: "", name: "", method: "test", status: "planned", description: "", lastRun: null });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = testInput.safeParse(v);
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
      <Field label="ID" htmlFor="t-id">
        <input id="t-id" className={inputCls} placeholder="TST-ENV-02" value={v.id} onChange={(e) => setV({ ...v, id: e.target.value.toUpperCase() })} />
      </Field>
      <Field label="Name" htmlFor="t-name">
        <input id="t-name" className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label="Method" htmlFor="t-method">
        <select id="t-method" className={inputCls} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as TestInput["method"] })}>
          {VERIFICATION_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="Result" htmlFor="t-status">
        <select id="t-status" className={inputCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as TestInput["status"] })}>
          {TEST_STATUSES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary">
          Create test
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
