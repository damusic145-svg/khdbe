import { Download, Loader2, Play } from 'lucide-react';
import type { NavSectionId, ProjectRecord } from '../types';
import { NAV_ITEMS } from './Sidebar';

interface TopBarProps {
  activeSection: NavSectionId;
  activeProject: ProjectRecord | null;
  isBusy: boolean;
  onStartAutoDub: () => void;
  onGoToExport: () => void;
}

export function TopBar({
  activeSection,
  activeProject,
  isBusy,
  onStartAutoDub,
  onGoToExport,
}: TopBarProps) {
  const sectionLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Studio';
  const isPipelineRunning =
    isBusy ||
    (activeProject !== null &&
      ['analyzing'].includes(activeProject.status) &&
      activeProject.progressPct > 0 &&
      activeProject.progressPct < 100);

  return (
    <header className="border-b border-white/8 bg-[#0E131F]/90 backdrop-blur px-6 py-3.5 sticky top-0 z-20">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0 flex items-center gap-3 text-sm">
          <span className="text-slate-400 whitespace-nowrap shrink-0">Studio</span>
          <span className="text-slate-600">/</span>
          <span className="font-display font-semibold text-slate-100 whitespace-nowrap shrink-0">
            {sectionLabel}
          </span>
          {activeProject && (
            <>
              <span className="text-slate-600">/</span>
              <span className="text-slate-300 truncate max-w-[260px]" title={activeProject.name}>
                {activeProject.name}
              </span>
              <span className="text-slate-500 text-xs font-mono tabular-nums whitespace-nowrap shrink-0">
                {activeProject.width}x{activeProject.height} · {activeProject.durationSec.toFixed(1)}s
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={!activeProject || isPipelineRunning}
            onClick={onStartAutoDub}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            {isPipelineRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>START AUTO DUBBING</span>
          </button>

          <button
            type="button"
            disabled={!activeProject}
            onClick={onGoToExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-100 border border-white/10 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT VIDEO</span>
          </button>
        </div>
      </div>

      {activeProject && (
        <div className="mt-2.5 flex items-center gap-4">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                activeProject.status === 'error' ? 'bg-red-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, activeProject.progressPct))}%` }}
            />
          </div>
          <span className="text-xs text-slate-400 truncate max-w-[460px]">
            {activeProject.currentStep}
          </span>
          <span className="text-xs font-mono tabular-nums text-slate-300 shrink-0">
            {activeProject.progressPct}%
          </span>
        </div>
      )}
    </header>
  );
}
