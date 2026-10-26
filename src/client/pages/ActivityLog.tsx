import { api } from "../api.ts";
import { Empty, ErrorBanner, Loading, PageHeader, Tag, useAsync } from "../components/ui.tsx";

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ActivityLog() {
  const { data, error, loading, reload } = useAsync(() => api.audit(200), []);
  return (
    <>
      <PageHeader
        title="Activity"
        description="Every change is recorded with what changed and when. This demo has no user accounts, so it does not record who made each change."
      />
      {loading ? <Loading /> : null}
      {error ? <ErrorBanner error={error} onRetry={reload} /> : null}
      {data ? (
        data.length ? (
          <ol className="divide-y divide-line border border-line bg-raised">
            {data.map((a) => (
              <li key={a.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[11rem_6rem_minmax(0,1fr)] sm:gap-4">
                <time dateTime={a.at} className="tabular text-xs text-muted sm:text-sm">
                  {fmt.format(new Date(a.at))}
                </time>
                <span>
                  <Tag tone={a.action === "delete" ? "bad" : a.action === "create" ? "ok" : "muted"}>{a.action}</Tag>
                </span>
                <span className="text-ink">
                  <span className="type-condensed mr-2 text-accent">{a.entityId}</span>
                  {a.summary}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No changes recorded yet.</Empty>
        )
      ) : null}
    </>
  );
}
