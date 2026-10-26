import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { api, type RequirementDetail as Detail } from "../api.ts";
import { Button, Empty, ErrorBanner, Loading, Panel, StateBadge, Tag, TestStatusTag, inputCls, useAsync } from "../components/ui.tsx";
import { RequirementForm } from "../components/RequirementForm.tsx";

export function RequirementDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const data = useAsync(() => Promise.all([api.requirement(id), api.components(), api.tests(), api.requirements()]), [id]);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBanner error={data.error} onRetry={data.reload} />;
  const [r, components, tests, all] = data.data!;

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      data.reload();
    } catch (e) {
      setActionError(e as Error);
    }
  }

  const linkedComponents = r.links.filter((l) => l.targetType === "component");
  const linkedTests = r.links.filter((l) => l.targetType === "test");
  const compName = new Map(components.map((c) => [c.id, c.name]));
  const testById = new Map(tests.map((t) => [t.id, t]));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-xs text-muted">
        <Link to="/requirements" className="hover:text-ink">
          Requirements
        </Link>
        {r.impact.ancestors
          .slice()
          .reverse()
          .map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <ChevronRight size={12} aria-hidden />
              <Link to={`/requirements/${a.id}`} className="hover:text-ink">
                {a.id}
              </Link>
            </span>
          ))}
        <ChevronRight size={12} aria-hidden />
        <span aria-current="page">{r.id}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="type-condensed text-accent">{r.id}</p>
          <h1 className="type-display text-2xl">{r.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {r.status === "deferred" ? <Tag>deferred</Tag> : <StateBadge state={r.verificationState} />}
            <Tag tone={r.priority === "high" ? "bad" : "muted"}>{r.priority} priority</Tag>
            <Tag>{r.type}</Tag>
            <Tag>{r.status}</Tag>
            <span className="text-muted">verified by {r.verificationMethod}</span>
          </div>
        </div>
        {!editing ? (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden /> Edit
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                window.confirm(`Delete ${r.id} and its trace links?`) &&
                act(async () => {
                  await api.deleteRequirement(r.id);
                  navigate("/requirements");
                })
              }
            >
              <Trash2 size={14} aria-hidden /> Delete
            </Button>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorBanner error={actionError} />
        </div>
      ) : null}

      {editing ? (
        <Panel title={`Edit ${r.id}`} className="mb-6">
          <p className="mb-4 text-xs text-muted">Changing the title or description marks this requirement's links as suspect until someone reviews them.</p>
          <RequirementForm
            initial={r}
            parents={all}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (v) => {
              const { id: _id, ...patch } = v;
              void _id;
              await api.updateRequirement(r.id, patch);
              setEditing(false);
              data.reload();
            }}
          />
        </Panel>
      ) : (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Panel title="Statement">
            <p className="text-sm whitespace-pre-wrap text-ink">{r.description || <span className="text-muted">No description yet.</span>}</p>
            {r.rationale ? (
              <>
                <h3 className="mt-4 text-xs text-muted">Rationale</h3>
                <p className="text-sm text-ink">{r.rationale}</p>
              </>
            ) : null}
          </Panel>
          <Panel title="Decomposition">
            {r.children.length ? (
              <ul className="space-y-1.5 text-sm">
                {r.children.map((c) => (
                  <li key={c.id}>
                    <Link to={`/requirements/${c.id}`} className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                      {c.id}
                    </Link>{" "}
                    <span className="text-ink">{c.title}</span> <span className="text-xs text-muted">{c.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No child requirements. This is a leaf requirement.</p>
            )}
          </Panel>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Allocated to components">
          {linkedComponents.length ? (
            <ul className="divide-y divide-line">
              {linkedComponents.map((l) => (
                <LinkRow
                  key={l.targetId}
                  id={l.targetId}
                  name={compName.get(l.targetId) ?? ""}
                  suspect={l.suspect}
                  onReview={() => act(() => api.reviewLink({ requirementId: r.id, targetType: "component", targetId: l.targetId }))}
                  onRemove={() => act(() => api.unlink({ requirementId: r.id, targetType: "component", targetId: l.targetId }))}
                />
              ))}
            </ul>
          ) : (
            <Empty>
              {r.children.length
                ? r.allocated
                  ? "No direct allocation. Allocated through its child requirements."
                  : "No direct allocation, and not every child requirement is allocated yet."
                : "Not allocated. Add the component that will satisfy this requirement."}
            </Empty>
          )}
          <AddLink
            label="Allocate to component"
            options={components.filter((c) => !linkedComponents.some((l) => l.targetId === c.id)).map((c) => ({ id: c.id, name: c.name }))}
            onAdd={(targetId) => act(() => api.link({ requirementId: r.id, targetType: "component", targetId }))}
          />
        </Panel>

        <Panel title="Verified by tests">
          {linkedTests.length ? (
            <ul className="divide-y divide-line">
              {linkedTests.map((l) => {
                const t = testById.get(l.targetId);
                return (
                  <LinkRow
                    key={l.targetId}
                    id={l.targetId}
                    name={t?.name ?? ""}
                    extra={
                      t ? (
                        <>
                          <TestStatusTag status={t.status} /> <span className="text-xs text-muted">{t.method}</span>
                        </>
                      ) : null
                    }
                    suspect={l.suspect}
                    onReview={() => act(() => api.reviewLink({ requirementId: r.id, targetType: "test", targetId: l.targetId }))}
                    onRemove={() => act(() => api.unlink({ requirementId: r.id, targetType: "test", targetId: l.targetId }))}
                  />
                );
              })}
            </ul>
          ) : (
            <Empty>
              {r.children.length
                ? "No direct test. Its verification state is rolled up from its child requirements."
                : "No verification test. Link one so this requirement can be proven."}
            </Empty>
          )}
          <AddLink
            label="Link verification test"
            options={tests.filter((t) => !linkedTests.some((l) => l.targetId === t.id)).map((t) => ({ id: t.id, name: t.name }))}
            onAdd={(targetId) => act(() => api.link({ requirementId: r.id, targetType: "test", targetId }))}
          />
        </Panel>
      </div>

      <Impact r={r} />
    </>
  );
}

function LinkRow({
  id,
  name,
  extra,
  suspect,
  onReview,
  onRemove,
}: {
  id: string;
  name: string;
  extra?: React.ReactNode;
  suspect: boolean;
  onReview: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="type-condensed text-ink">{id}</span>
      <span className="text-muted">{name}</span>
      {extra}
      {suspect ? (
        <span className="inline-flex items-center gap-1 text-xs text-warn">
          <AlertTriangle size={12} aria-hidden /> Suspect
        </span>
      ) : null}
      <span className="ml-auto flex gap-1">
        {suspect ? (
          <Button variant="secondary" onClick={onReview} className="py-1 text-xs">
            Mark reviewed
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onRemove} aria-label={`Remove link to ${id}`} className="px-1.5">
          <X size={14} aria-hidden />
        </Button>
      </span>
    </li>
  );
}

function AddLink({ label, options, onAdd }: { label: string; options: { id: string; name: string }[]; onAdd: (id: string) => void }) {
  const [choice, setChoice] = useState("");
  const selectId = `add-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="mt-3 flex gap-2 border-t border-line pt-3">
      <label htmlFor={selectId} className="sr-only">
        {label}
      </label>
      <select id={selectId} className={inputCls} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">{label}…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id}: {o.name}
          </option>
        ))}
      </select>
      <Button
        disabled={!choice}
        onClick={() => {
          onAdd(choice);
          setChoice("");
        }}
      >
        Add
      </Button>
    </div>
  );
}

function Impact({ r }: { r: Detail }) {
  const i = r.impact;
  const total = i.descendants.length + i.components.length + i.tests.length + i.related.length;
  return (
    <Panel title="Impact analysis" className="mt-6">
      <p className="mb-4 text-sm text-muted">
        If {r.id} changes, these {total} items may need review: its child requirements, the components and tests linked to it or its children,
        and other requirements that share those components.
      </p>
      <div className="grid gap-6 text-sm md:grid-cols-2 xl:grid-cols-4">
        <ImpactList title="Child requirements" items={i.descendants.map((d) => ({ id: d.id, text: d.title, href: `/requirements/${d.id}` }))} />
        <ImpactList title="Components" items={i.components.map((c) => ({ id: c.id, text: c.name }))} />
        <ImpactList title="Tests to re-run" items={i.tests.map((t) => ({ id: t.id, text: t.name }))} />
        <ImpactList title="Requirements sharing a component" items={i.related.map((d) => ({ id: d.id, text: d.title, href: `/requirements/${d.id}` }))} />
      </div>
    </Panel>
  );
}

function ImpactList({ title, items }: { title: string; items: { id: string; text: string; href?: string }[] }) {
  return (
    <div>
      <h3 className="type-condensed text-ink">
        {title} <span className="tabular text-muted">({items.length})</span>
      </h3>
      {items.length ? (
        <ul className="mt-2 space-y-1">
          {items.map((x) => (
            <li key={x.id}>
              {x.href ? (
                <Link to={x.href} className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                  {x.id}
                </Link>
              ) : (
                <span className="text-ink">{x.id}</span>
              )}{" "}
              <span className="text-muted">{x.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">None</p>
      )}
    </div>
  );
}
