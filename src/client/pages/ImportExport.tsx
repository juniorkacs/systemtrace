import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { api } from "../api.ts";
import { Button, ErrorBanner, Field, PageHeader, Panel, inputCls } from "../components/ui.tsx";
import { CSV_COLUMNS } from "../../shared/csv.ts";

export function ImportExport() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const isCsv = file?.name.toLowerCase().endsWith(".csv") ?? false;

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("That file is larger than 2 MB. Split it into smaller files.");
      const text = await file.text();
      let res;
      if (isCsv) res = await api.importCsv(text);
      else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("That file is not valid JSON. Export a model first to see the expected format.");
        }
        res = await api.importJson(parsed, mode);
      }
      setResult(
        `Imported ${res.counts.requirements} requirements, ${res.counts.components} components, ${res.counts.tests} tests and ${res.counts.links} links.`,
      );
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Import and export" description="Move requirements in and out as CSV for spreadsheets, or the whole model as JSON for backups and tool exchange." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Export">
          <p className="text-sm text-muted">JSON contains the full model. CSV contains requirements, one per row, with linked component and test IDs.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/api/export?format=json" className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink">
              <Download size={14} aria-hidden /> Download model (JSON)
            </a>
            <a href="/api/export?format=csv" className="inline-flex items-center gap-1.5 border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent">
              <Download size={14} aria-hidden /> Download requirements (CSV)
            </a>
          </div>
          <h3 className="mt-6 text-xs text-muted">CSV columns</h3>
          <p className="mt-1 text-sm break-words text-ink">{CSV_COLUMNS.join(", ")}</p>
          <p className="mt-1 text-xs text-muted">Separate multiple IDs in the components and tests columns with semicolons. Only id and title are required.</p>
        </Panel>

        <Panel title="Import">
          <div className="space-y-4">
            <Field label="File (.json or .csv, up to 2 MB)" htmlFor="import-file">
              <input
                id="import-file"
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className={`${inputCls} file:mr-3 file:border-0 file:bg-raised file:px-2 file:py-1 file:text-ink`}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                  setError(null);
                }}
              />
            </Field>
            {!isCsv ? (
              <fieldset>
                <legend className="mb-1 text-xs text-muted">What to do with existing data</legend>
                <div className="flex flex-col gap-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge: update matching IDs, add new ones
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace: delete everything first
                  </label>
                </div>
              </fieldset>
            ) : (
              <p className="text-xs text-muted">CSV files are always merged, because they do not contain components or tests.</p>
            )}
            <Button variant="primary" disabled={!file || busy} onClick={upload}>
              <Upload size={14} aria-hidden /> {busy ? "Importing…" : "Import file"}
            </Button>
            <p className="text-xs text-muted">Imports are all-or-nothing: if any row is invalid, nothing changes and every problem is listed.</p>
            {result ? (
              <p role="status" className="border border-ok/50 bg-ok/10 px-3 py-2 text-sm text-ink">
                {result}
              </p>
            ) : null}
            {error ? <ErrorBanner error={error} /> : null}
          </div>
        </Panel>
      </div>
    </>
  );
}
