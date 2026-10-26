import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { Activity, Boxes, FileInput, FlaskConical, GitBranch, LayoutDashboard, ListTree, RotateCcw } from "lucide-react";
import { api } from "./api.ts";
import { Button } from "./components/ui.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Requirements } from "./pages/Requirements.tsx";
import { RequirementDetail } from "./pages/RequirementDetail.tsx";
import { Traceability } from "./pages/Traceability.tsx";
import { Components } from "./pages/Components.tsx";
import { Tests } from "./pages/Tests.tsx";
import { ActivityLog } from "./pages/ActivityLog.tsx";
import { ImportExport } from "./pages/ImportExport.tsx";
import { NotFound } from "./pages/NotFound.tsx";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/requirements", label: "Requirements", icon: ListTree },
  { to: "/traceability", label: "Traceability", icon: GitBranch },
  { to: "/components", label: "Components", icon: Boxes },
  { to: "/tests", label: "Verification tests", icon: FlaskConical },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/data", label: "Import and export", icon: FileInput },
];

export function App() {
  // Bumping this key remounts the current page so it refetches after a reset.
  const [version, setVersion] = useState(0);
  const [resetting, setResetting] = useState(false);

  async function reset() {
    if (!window.confirm("Replace all data with the Kestrel AG-1 demo model?")) return;
    setResetting(true);
    try {
      await api.resetDemo();
      setVersion((v) => v + 1);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-line bg-sunken md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div>
            <p className="type-display text-lg text-ink">SystemTrace</p>
            <p className="text-xs text-muted">Kestrel AG-1 crop-survey UAS</p>
          </div>
        </div>
        <nav aria-label="Main" className="overflow-x-auto px-2 pb-3 md:pb-0">
          <ul className="flex gap-1 md:block md:space-y-0.5">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 text-sm whitespace-nowrap ${
                      isActive ? "bg-raised text-ink shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:text-ink"
                    }`
                  }
                >
                  <Icon size={16} aria-hidden /> {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden px-4 pt-6 md:block">
          <Button variant="ghost" onClick={reset} disabled={resetting} className="px-0">
            <RotateCcw size={14} aria-hidden /> {resetting ? "Resetting…" : "Reset demo data"}
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Synthetic data for a fictional civilian aircraft. Not based on any real program.
          </p>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 md:px-8 md:py-8" key={version}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/requirements" element={<Requirements />} />
          <Route path="/requirements/:id" element={<RequirementDetail />} />
          <Route path="/traceability" element={<Traceability />} />
          <Route path="/components" element={<Components />} />
          <Route path="/tests" element={<Tests />} />
          <Route path="/activity" element={<ActivityLog />} />
          <Route path="/data" element={<ImportExport />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
