import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { Button, ErrorBanner, Loading, PageHeader, STATE_COLOR, StateBadge, useAsync } from "../components/ui.tsx";
import type { Model } from "../../shared/schema.ts";
import { TraceIndex, isActive, verificationState } from "../../shared/trace.ts";

type View = "matrix-component" | "matrix-test" | "graph";

export function Traceability() {
  const [view, setView] = useState<View>("graph");
  return (
    <>
      <PageHeader
        title="Traceability"
        description="How requirements connect to the components that satisfy them and the tests that verify them. Gaps show up as empty rows and unconnected nodes."
      />
      <div role="tablist" aria-label="Traceability views" className="mb-4 flex gap-1 border-b border-line">
        {(
          [
            ["graph", "Trace graph"],
            ["matrix-component", "Allocation matrix"],
            ["matrix-test", "Verification matrix"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === v ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "graph" ? <Graph /> : <MatrixView axis={view === "matrix-component" ? "component" : "test"} />}
    </>
  );
}

function MatrixView({ axis }: { axis: "component" | "test" }) {
  const { data, error, loading, reload } = useAsync(() => api.matrix(axis), [axis]);
  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const m = data!;
  const colTotals = m.columns.map((_, j) => m.cells.reduce((n, row) => n + (row[j] !== "none" ? 1 : 0), 0));

  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        <span className="mr-1 inline-block size-2.5 bg-accent align-middle" /> linked
        <span className="mr-1 ml-4 inline-block size-2.5 border border-warn bg-warn/30 align-middle" /> suspect (requirement changed since review)
        <span className="ml-4">Columns with a total of 0 have nothing tracing to them.</span>
      </p>
      <div className="max-h-[70vh] overflow-auto border border-line">
        <table className="border-collapse text-xs">
          <caption className="sr-only">{axis === "component" ? "Requirements allocated to components" : "Requirements verified by tests"}</caption>
          <thead className="sticky top-0 z-10 bg-sunken">
            <tr>
              <th scope="col" className="sticky left-0 z-20 min-w-[16rem] bg-sunken px-3 py-2 text-left font-normal text-muted">
                Requirement
              </th>
              {m.columns.map((c, j) => (
                <th key={c.id} scope="col" className="h-40 w-8 border-l border-line align-bottom font-normal">
                  <div className="mx-auto w-5 [writing-mode:vertical-rl] rotate-180 pb-1 text-left whitespace-nowrap text-muted" title={c.name}>
                    <span className="text-ink">{c.id}</span> <span className={colTotals[j] ? "" : "text-warn"}>({colTotals[j]})</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r, i) => {
              const empty = m.cells[i].every((c) => c === "none");
              return (
                <tr key={r.id} className="border-t border-line hover:bg-raised">
                  <th scope="row" className="sticky left-0 bg-bg px-3 py-1.5 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <Link to={`/requirements/${r.id}`} className="type-condensed w-16 shrink-0 text-accent hover:underline">
                        {r.id}
                      </Link>
                      <span className="max-w-[12rem] truncate text-muted" title={r.title}>
                        {r.title}
                      </span>
                      {empty ? <span className="ml-auto text-warn">none</span> : null}
                    </span>
                  </th>
                  {m.cells[i].map((cell, j) => (
                    <td key={m.columns[j].id} className="border-l border-line text-center">
                      {cell === "linked" ? (
                        <span className="inline-block size-3 bg-accent" aria-label={`${r.id} linked to ${m.columns[j].id}`} />
                      ) : cell === "suspect" ? (
                        <span className="inline-block size-3 border border-warn bg-warn/30" aria-label={`${r.id} suspect link to ${m.columns[j].id}`} />
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROW = 30;
const COL_W = 260;

/** Three-column trace graph: components, requirements, tests. Select a node to trace its links. */
function Graph() {
  const { data, error, loading, reload } = useAsync(() => api.model(), []);
  const [focus, setFocus] = useState<string | null>(null);
  const layout = useMemo(() => (data ? buildLayout(data) : null), [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const g = layout!;

  const connected = new Set<string>();
  if (focus) {
    connected.add(focus);
    for (const e of g.edges) {
      if (e.from === focus || e.to === focus) {
        connected.add(e.from);
        connected.add(e.to);
      }
    }
  }
  const dim = (id: string) => (focus && !connected.has(id) ? 0.25 : 1);
  const width = COL_W * 3 + 240;
  const x = { component: 0, requirement: COL_W + 120, test: COL_W * 2 + 240 };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>Select any node to highlight what it traces to. Unconnected nodes are outlined in amber.</span>
        {focus ? (
          <Button variant="ghost" onClick={() => setFocus(null)} className="py-0.5 text-xs">
            Clear selection
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto border border-line bg-sunken p-4">
        <svg width={width} height={g.height + 40} role="group" aria-label="Trace graph" className="block">
          {(["component", "requirement", "test"] as const).map((k) => (
            <text key={k} x={x[k]} y={14} className="fill-[var(--muted)] text-[12px]">
              {k === "component" ? "Components (satisfy)" : k === "requirement" ? "Requirements" : "Tests (verify)"}
            </text>
          ))}
          <g transform="translate(0,30)">
            {g.edges.map((e) => {
              const a = g.nodes.get(e.from)!;
              const b = g.nodes.get(e.to)!;
              const x1 = a.kind === "component" ? x.component + COL_W : x.requirement + COL_W;
              const x2 = b.kind === "requirement" ? x.requirement : x.test;
              const y1 = a.y + ROW / 2 - 4;
              const y2 = b.y + ROW / 2 - 4;
              const active = focus && connected.has(e.from) && connected.has(e.to) && (e.from === focus || e.to === focus);
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={`M${x1} ${y1} C${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={e.suspect ? "var(--warn)" : active ? "var(--accent)" : "var(--line-strong)"}
                  strokeDasharray={e.suspect ? "4 3" : undefined}
                  strokeWidth={active ? 1.6 : 1}
                  opacity={focus ? (active ? 1 : 0.12) : 0.7}
                />
              );
            })}
            {[...g.nodes.values()].map((n) => (
              <g key={n.id} transform={`translate(${x[n.kind]},${n.y})`} opacity={dim(n.id)}>
                <rect
                  width={COL_W}
                  height={ROW - 8}
                  fill="var(--raised)"
                  stroke={focus === n.id ? "var(--accent)" : n.degree === 0 ? "var(--warn)" : "var(--line)"}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.id} ${n.label}${n.degree === 0 ? ", not connected" : ""}`}
                  aria-pressed={focus === n.id}
                  onClick={() => setFocus(focus === n.id ? null : n.id)}
                  onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setFocus(focus === n.id ? null : n.id))}
                  className="cursor-pointer outline-none focus-visible:stroke-[var(--accent)]"
                />
                {n.color ? <rect width={3} height={ROW - 8} fill={n.color} pointerEvents="none" /> : null}
                <text x={10} y={15} className="pointer-events-none fill-[var(--ink)] text-[11px]" style={{ fontVariationSettings: '"wdth" 75', fontWeight: 600 }}>
                  {n.id}
                </text>
                <text x={n.kind === "requirement" ? 74 : 92} y={15} className="pointer-events-none fill-[var(--muted)] text-[11px]">
                  {truncate(n.label, n.kind === "requirement" ? 31 : 26)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      {focus && g.nodes.get(focus)?.kind === "requirement" ? (
        <p className="mt-3 text-sm">
          <Link to={`/requirements/${focus}`} className="text-accent hover:underline">
            Open {focus}
          </Link>{" "}
          <span className="text-muted">to edit its links or run impact analysis.</span>{" "}
          <StateBadge state={g.nodes.get(focus)!.state!} />
        </p>
      ) : null}
    </div>
  );
}

type GNode = {
  id: string;
  label: string;
  kind: "component" | "requirement" | "test";
  y: number;
  degree: number;
  color?: string;
  state?: ReturnType<typeof verificationState>;
};

function buildLayout(model: Model) {
  const idx = new TraceIndex(model);
  const nodes = new Map<string, GNode>();
  const reqs = model.requirements.filter(isActive);
  const sorted = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  sorted(reqs).forEach((r, i) => {
    const state = verificationState(idx, r.id);
    nodes.set(r.id, { id: r.id, label: r.title, kind: "requirement", y: i * ROW, degree: 0, state, color: STATE_COLOR[state] });
  });
  const span = reqs.length * ROW;
  const comps = sorted(model.components);
  const step = (n: number) => Math.max(ROW, n > 1 ? span / n : ROW);
  comps.forEach((c, i) => nodes.set(c.id, { id: c.id, label: c.name, kind: "component", y: i * step(comps.length), degree: 0 }));
  const tests = sorted(model.tests);
  tests.forEach((t, i) =>
    nodes.set(t.id, {
      id: t.id,
      label: t.name,
      kind: "test",
      y: i * step(tests.length),
      degree: 0,
      color: t.status === "passed" ? "var(--ok)" : t.status === "failed" ? "var(--bad)" : t.status === "blocked" ? "#c98a2b" : "var(--info)",
    }),
  );
  const edges = model.links
    .filter((l) => nodes.has(l.requirementId) && nodes.has(l.targetId))
    .map((l) =>
      l.targetType === "component"
        ? { from: l.targetId, to: l.requirementId, suspect: l.suspect }
        : { from: l.requirementId, to: l.targetId, suspect: l.suspect },
    );
  for (const e of edges) {
    nodes.get(e.from)!.degree++;
    nodes.get(e.to)!.degree++;
  }
  // Parent requirements are "connected" through their children.
  for (const r of reqs) if ((idx.children.get(r.id) ?? []).length) nodes.get(r.id)!.degree++;
  // Parent components are connected through child components.
  for (const c of model.components) if (c.parentId && nodes.get(c.id)!.degree > 0 && nodes.has(c.parentId)) nodes.get(c.parentId)!.degree++;
  const height = Math.max(...[...nodes.values()].map((n) => n.y)) + ROW;
  return { nodes, edges, height };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
