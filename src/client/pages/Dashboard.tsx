import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { ErrorBanner, Loading, PageHeader, Panel, STATE_COLOR, StateBadge, Tag, useAsync } from "../components/ui.tsx";
import type { Gap, GapKind, Metrics, VerificationState } from "../../shared/trace.ts";

export const GAP_LABELS: Record<GapKind, { label: string; help: string }> = {
  failing: { label: "Failing verification", help: "A linked test has failed." },
  unverified: { label: "No verification test", help: "Leaf requirements with nothing planned to verify them." },
  unallocated: { label: "Not allocated", help: "Leaf requirements that no component satisfies." },
  "status-inconsistent": { label: "Status disagrees with tests", help: "Marked verified, but the tests say otherwise." },
  "method-mismatch": { label: "Method mismatch", help: "Planned verification method is not used by any linked test." },
  "suspect-link": { label: "Suspect links", help: "The requirement changed after this link was last reviewed." },
  "orphan-requirement": { label: "Orphan requirements", help: "Trace to nothing at all." },
  "orphan-component": { label: "Orphan components", help: "Satisfy no requirement. Possible unneeded scope." },
  "orphan-test": { label: "Orphan tests", help: "Verify no requirement." },
};
const GAP_ORDER = Object.keys(GAP_LABELS) as GapKind[];

export function Dashboard() {
  const { data, error, loading, reload } = useAsync(() => Promise.all([api.metrics(), api.gaps()]), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  const [m, gaps] = data!;

  return (
    <>
      <PageHeader
        title="Traceability overview"
        description="Coverage is calculated from the current trace links every time this page loads. Percentages count leaf requirements only, so a parent and its children are not double-counted."
      />
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Allocated to a component" value={m.allocationCoverage} detail={`${m.allocated} of ${m.leafRequirements} leaf requirements`} />
        <Kpi label="Have a verification test" value={m.verificationPlannedCoverage} detail={`${m.withTests} of ${m.leafRequirements}`} />
        <Kpi label="Verified and passing" value={m.verificationPassedCoverage} detail={`${m.passed} of ${m.leafRequirements}`} />
        <div className="bg-raised p-4">
          <p className="text-sm text-muted">Needs attention</p>
          <p className="type-display mt-1 text-3xl tabular">{gaps.length}</p>
          <p className="mt-1 text-xs text-muted">
            {m.failing} failing, {m.suspectLinks} suspect link{m.suspectLinks === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Open traceability gaps">
          <GapList gaps={gaps} />
        </Panel>
        <div className="space-y-6">
          <Panel title="Verification state of leaf requirements">
            <StateBar m={m} />
          </Panel>
          <Panel title="Model size">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Requirements</dt>
              <dd className="tabular text-right">
                {m.totalRequirements} <span className="text-muted">({m.deferredRequirements} deferred)</span>
              </dd>
              <dt className="text-muted">Components and interfaces</dt>
              <dd className="tabular text-right">{m.components}</dd>
              <dt className="text-muted">Verification tests</dt>
              <dd className="tabular text-right">{m.tests}</dd>
              {Object.entries(m.testsByStatus).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="pl-3 text-muted">{k}</dt>
                  <dd className="tabular text-right text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="bg-raised p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="type-display mt-1 text-3xl tabular">
        {value}
        <span className="text-lg text-muted">%</span>
      </p>
      <div className="mt-2 h-1 bg-sunken" aria-hidden>
        <div className="h-1 bg-accent" style={{ width: `${value}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

function StateBar({ m }: { m: Metrics }) {
  const order: VerificationState[] = ["passed", "planned", "blocked", "unverified", "failing"];
  const total = m.leafRequirements || 1;
  return (
    <div>
      <div className="flex h-3 w-full gap-px overflow-hidden bg-sunken" role="img" aria-label={order.map((s) => `${s}: ${m.byVerificationState[s]}`).join(", ")}>
        {order.map((s) =>
          m.byVerificationState[s] ? (
            <div key={s} style={{ width: `${(m.byVerificationState[s] / total) * 100}%`, background: STATE_COLOR[s] }} />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {order.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2">
            <StateBadge state={s} />
            <span className="tabular text-muted">{m.byVerificationState[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GapList({ gaps }: { gaps: Gap[] }) {
  if (gaps.length === 0) return <p className="text-sm text-ok">No gaps. Every leaf requirement is allocated and verified.</p>;
  const groups = GAP_ORDER.map((k) => ({ kind: k, items: gaps.filter((g) => g.kind === k) })).filter((g) => g.items.length);
  return (
    <div className="divide-y divide-line">
      {groups.map(({ kind, items }) => (
        <details key={kind} open={kind === "failing" || kind === "unverified" || kind === "unallocated"} className="group py-2.5 first:pt-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span>
              <span className="text-sm text-ink">{GAP_LABELS[kind].label}</span>
              <span className="ml-2 text-xs text-muted">{GAP_LABELS[kind].help}</span>
            </span>
            <Tag tone={kind === "failing" ? "bad" : "warn"}>{items.length}</Tag>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {items.map((g) => (
              <li key={`${g.kind}-${g.id}`} className="flex items-start gap-2 text-sm">
                {g.priority === "high" ? <Tag tone="bad">high</Tag> : null}
                <GapTarget gap={g} />
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function GapTarget({ gap }: { gap: Gap }) {
  const reqId = gap.entity === "requirement" ? gap.id : gap.entity === "link" ? gap.id.split("->")[0] : null;
  const text = <span className="text-muted">{gap.message}</span>;
  if (reqId) {
    return (
      <Link to={`/requirements/${reqId}`} className="hover:underline">
        {text}
      </Link>
    );
  }
  return <Link to={gap.entity === "component" ? "/components" : "/tests"} className="hover:underline">{text}</Link>;
}
