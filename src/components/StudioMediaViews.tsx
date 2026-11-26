import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  Sliders,
  Trash2,
} from 'lucide-react';
import type {
  AppSettings,
  AsrEngineOption,
  BatchExportJob,
  GeminiModelOption,
  NavSectionId,
  ProjectRecord,
  SegmentRecord,
} from '../types';
import { formatSec } from './PipelineViews';

interface AudioSyncProps {
  activeProject: ProjectRecord | null;
  segments: SegmentRecord[];
  onUpdateProject: (patch: Partial<ProjectRecord>) => Promise<void>;
  onRunMix: () => Promise<void>;
}

export function AudioSyncView({
  activeProject,
  segments,
  onUpdateProject,
  onRunMix,
}: AudioSyncProps) {
  const [mixing, setMixing] = useState(false);

  if (!activeProject) {
    return (
      <div className="bg-[#121826] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
        Import and dub a video first to configure audio mixing and timeline synchronization.
      </div>
    );
  }

  const handleMix = async () => {
    setMixing(true);
    try {
      await onRunMix();
    } finally {
      setMixing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-100">
              Audio Synchronization, Vocal Reduction &amp; Mixing
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Attenuates original dialogue while preserving background music and SFX, auto-fits Khmer speech timing to prevent overlap, and mixes both buses cleanly.
            </p>
          </div>
          <button
            type="button"
            disabled={mixing}
            onClick={handleMix}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {mixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sliders className="w-4 h-4" />}
            <span>{mixing ? 'Mixing & Building Preview...' : 'Sync & Mix Audio Track'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-white/8">
          <div>
            <div className="flex justify-between text-xs mb-2">
              <span className="text-slate-300">Original / BGM Volume</span>
              <span className="font-mono tabular-nums text-amber-400">
                {Math.round(activeProject.bgmVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={activeProject.bgmVolume}
              onChange={(e) => void onUpdateProject({ bgmVolume: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-2">
              <span className="text-slate-300">Khmer Dubbing Volume</span>
              <span className="font-mono tabular-nums text-amber-400">
                {Math.round(activeProject.dubVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1.5"
              step="0.05"
              value={activeProject.dubVolume}
              onChange={(e) => void onUpdateProject({ dubVolume: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-2">Original Dialogue Reduction</label>
            <select
              value={activeProject.voiceReductionMode}
              onChange={(e) =>
                void onUpdateProject({
                  voiceReductionMode: e.target.value as ProjectRecord['voiceReductionMode'],
                })
              }
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100"
            >
              <option value="soft">Soft Center Attenuation + Ducking (Recommended)</option>
              <option value="aggressive">Aggressive Center Vocal Removal</option>
              <option value="off">Off (Volume Ducking Only)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 text-xs font-medium text-slate-400">
          Timeline Sync Alignment ({segments.length} segments)
        </div>
        <div className="divide-y divide-white/6 max-h-[380px] overflow-y-auto">
          {segments.map((seg) => {
            const slotDur = Math.max(0.1, seg.endTime - seg.startTime);
            return (
              <div key={seg.id} className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 font-mono text-slate-400 tabular-nums">
                    <span>{formatSec(seg.startTime)} - {formatSec(seg.endTime)}</span>
                    <span className="text-amber-400">{seg.speakerId}</span>
                    <span>Slot: {slotDur.toFixed(2)}s</span>
                    <span>Khmer TTS: {seg.ttsDurationSec ? `${seg.ttsDurationSec.toFixed(2)}s` : 'Pending'}</span>
                  </div>
                  <div className="khmer-text text-slate-200 truncate mt-1">
                    {seg.khmerText || seg.sourceText}
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-400 shrink-0">
                  {seg.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface VideoPreviewProps {
  activeProject: ProjectRecord | null;
  segments: SegmentRecord[];
}

export function VideoPreviewView({ activeProject, segments }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'dubbed' | 'original'>('dubbed');
  const [currentTime, setCurrentTime] = useState(0);

  if (!activeProject) {
    return (
      <div className="bg-[#121826] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
        Import a video first to inspect original and Khmer-dubbed playback.
      </div>
    );
  }

  const hasDubbedPreview = Boolean(activeProject.previewVideoPath);
  const srcUrl =
    mode === 'dubbed' && hasDubbedPreview
      ? `/api/projects/${activeProject.id}/media/preview?v=${encodeURIComponent(activeProject.updatedAt)}`
      : `/api/projects/${activeProject.id}/media/original`;

  const activeCue = segments.find((s) => currentTime >= s.startTime && currentTime <= s.endTime);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-100">
            Synchronized Video Preview
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {hasDubbedPreview
              ? 'Switch between the original source audio and the synchronized Khmer AI dub.'
              : 'Previewing original source video. Run START AUTO DUBBING or Sync & Mix Audio Track to hear the Khmer dub.'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-white/10 rounded-lg">
          <button
            type="button"
            onClick={() => setMode('dubbed')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'dubbed'
                ? 'bg-amber-500 text-[#0B0F17]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Khmer Dubbed Audio
          </button>
          <button
            type="button"
            onClick={() => setMode('original')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'original'
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Original Audio
          </button>
        </div>
      </div>

      <div className="bg-[#0B0F17] border border-white/10 rounded-xl overflow-hidden relative">
        <video
          ref={videoRef}
          key={srcUrl}
          src={srcUrl}
          controls
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          className="w-full max-h-[520px] bg-black"
        />
        {activeCue && (
          <div className="px-6 py-3 bg-[#121826] border-t border-white/8 text-center space-y-1">
            <div className="khmer-text text-base font-medium text-amber-300">
              {activeCue.khmerText || activeCue.sourceText}
            </div>
            <div className="text-xs text-slate-400">
              {activeCue.speakerId} · {activeCue.emotion} · {activeCue.sourceText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ExportViewProps {
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  exportJobs: BatchExportJob[];
  onTriggerExport: (payload: {
    projectId: string;
    resolution: '720p' | '1080p' | '4k' | 'original';
    codec: 'h264' | 'h265';
    exportSrt: boolean;
  }) => Promise<void>;
  onRefreshJobs: () => Promise<void>;
}

export function ExportMp4View({
  activeProject,
  projects,
  exportJobs,
  onTriggerExport,
  onRefreshJobs,
}: ExportViewProps) {
  const [selectedProjId, setSelectedProjId] = useState(activeProject?.id ?? '');
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k' | 'original'>('1080p');
  const [codec, setCodec] = useState<'h264' | 'h265'>('h264');
  const [exportSrt, setExportSrt] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (activeProject && !selectedProjId) {
      setSelectedProjId(activeProject.id);
    }
  }, [activeProject, selectedProjId]);

  useEffect(() => {
    const hasRunning = exportJobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasRunning) return;
    const t = setInterval(() => {
      void onRefreshJobs();
    }, 1500);
    return () => clearInterval(t);
  }, [exportJobs, onRefreshJobs]);

  const handleExport = async () => {
    const pid = selectedProjId || activeProject?.id;
    if (!pid) return;
    setSubmitting(true);
    try {
      await onTriggerExport({ projectId: pid, resolution, codec, exportSrt });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-100">
            Professional MP4 Video Export &amp; Batch Queue
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Render final Khmer-dubbed MP4 video in 720p, 1080p, 4K, or original resolution using H.264 or H.265 encoding, with optional separate Khmer .srt subtitles.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Project to Export</label>
            <select
              value={selectedProjId || activeProject?.id || ''}
              onChange={(e) => setSelectedProjId(e.target.value)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100"
            >
              {projects.length === 0 && <option value="">No projects available</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Output Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as typeof resolution)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100"
            >
              <option value="720p">720p HD</option>
              <option value="1080p">1080p Full HD (Recommended)</option>
              <option value="4k">4K Ultra HD</option>
              <option value="original">Preserve Original Resolution</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Video Codec</label>
            <select
              value={codec}
              onChange={(e) => setCodec(e.target.value as typeof codec)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100"
            >
              <option value="h264">H.264 / AVC (Universal Compatibility)</option>
              <option value="h265">H.265 / HEVC (Compact File Size)</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={exportSrt}
            onChange={(e) => setExportSrt(e.target.checked)}
            className="accent-amber-500"
          />
          <span>Also export Khmer subtitles separately (.srt file)</span>
        </label>

        <button
          type="button"
          disabled={submitting || (!selectedProjId && !activeProject)}
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-45 transition-colors"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span>EXPORT VIDEO</span>
        </button>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 text-xs font-medium text-slate-400">
          Export Queue &amp; Completed Downloads ({exportJobs.length})
        </div>
        {exportJobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No export jobs started yet. Click EXPORT VIDEO above to render your dubbed MP4.
          </div>
        ) : (
          <div className="divide-y divide-white/6">
            {exportJobs.map((job) => (
              <div key={job.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
                    <span className="truncate">{job.projectName}</span>
                    <span className="font-mono text-xs text-slate-400">
                      {job.resolution} · {job.codec.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${job.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'}`}
                        style={{ width: `${job.progressPct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {job.progressPct}%
                      {job.etaSeconds !== null && job.status === 'running' ? ` · ETA ${job.etaSeconds}s` : ''}
                    </span>
                    <span className="text-xs text-slate-400">{job.status}</span>
                  </div>
                  {job.errorMessage && <div className="text-xs text-red-400">{job.errorMessage}</div>}
                </div>

                {job.status === 'completed' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/api/exports/${job.id}/download?kind=mp4`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download MP4</span>
                    </a>
                    {job.srtPath && (
                      <a
                        href={`/api/exports/${job.id}/download?kind=srt`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-100 hover:bg-slate-700"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Khmer .SRT</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface HistoryViewProps {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => Promise<void>;
  onNavigate: (sec: NavSectionId) => void;
}

export function ProjectHistoryView({
  projects,
  activeProjectId,
  onSelectProject,
  onDeleteProject,
  onNavigate,
}: HistoryViewProps) {
  return (
    <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden max-w-5xl">
      <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-100">
            Saved Projects &amp; Resume History
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            All projects, transcripts, translations, and speaker assignments persist automatically in local SQLite storage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('import')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400"
        >
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">
          No saved projects yet. Import a video to create your first project.
        </div>
      ) : (
        <div className="divide-y divide-white/6">
          {projects.map((p) => (
            <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  <span className="truncate">{p.name}</span>
                  {activeProjectId === p.id && (
                    <span className="text-xs text-amber-400 font-normal">· Active</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  {p.originalFilename} · {p.width}x{p.height} · {p.durationSec.toFixed(1)}s · Status: {p.status} ({p.progressPct}%)
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onSelectProject(p.id);
                    onNavigate('preview');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-100 hover:bg-slate-700"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open Project</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteProject(p.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                  title="Delete Project"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsViewProps {
  settings: AppSettings | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

export function SettingsView({ settings, onUpdateSettings }: SettingsViewProps) {
  const [savedNotice, setSavedNotice] = useState(false);

  if (!settings) return null;

  const save = async (patch: Partial<AppSettings>) => {
    await onUpdateSettings(patch);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-100">
              Application &amp; Processing Settings
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Optimize chunk sizes, default AI engines, automatic audio speed fitting, and output paths.
            </p>
          </div>
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Default Gemini Model</label>
            <select
              value={settings.defaultGeminiModel}
              onChange={(e) => void save({ defaultGeminiModel: e.target.value as GeminiModelOption })}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100"
            >
              <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Recommended)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
              <option value="gemini-4-neon">Gemini 4 Neon</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Default Speech Recognition Engine</label>
            <select
              value={settings.defaultAsrEngine}
              onChange={(e) => void save({ defaultAsrEngine: e.target.value as AsrEngineOption })}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100"
            >
              <option value="auto">Auto (Groq Whisper with Gemini Fallback)</option>
              <option value="groq-whisper">Groq Whisper API</option>
              <option value="gemini-transcribe">Gemini Audio Transcription</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Long-Video Audio Chunk Size (Seconds)
            </label>
            <input
              type="number"
              min="30"
              max="240"
              step="15"
              defaultValue={settings.chunkDurationSec}
              onBlur={(e) => void save({ chunkDurationSec: Number(e.target.value) || 90 })}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Max Auto Speed-Fit Ratio (Prevents Overlap)
            </label>
            <input
              type="number"
              min="1.05"
              max="1.6"
              step="0.05"
              defaultValue={settings.maxSpeedFitRatio}
              onBlur={(e) => void save({ maxSpeedFitRatio: Number(e.target.value) || 1.32 })}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
            />
          </div>
        </div>

        <div className="space-y-2.5 pt-2 border-t border-white/8 text-xs text-slate-300">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoDuckingEnabled}
              onChange={(e) => void save({ autoDuckingEnabled: e.target.checked })}
              className="accent-amber-500"
            />
            <span>Automatically duck background music &amp; SFX during Khmer dialogue</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoSpeedFitEnabled}
              onChange={(e) => void save({ autoSpeedFitEnabled: e.target.checked })}
              className="accent-amber-500"
            />
            <span>Automatically adjust Khmer speaking speed to match original scene timing</span>
          </label>
        </div>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-100">
              Windows 10/11 Desktop Package &amp; GitHub Actions Installer Builder
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Includes full Python 3.11 + PySide6 source code, PyInstaller spec, Inno Setup script for <span className="font-mono text-slate-200">AI_Khmer_Dubber_Pro_Setup.exe</span>, and a GitHub Actions workflow so you can build the Windows installer in the cloud without installing Python locally.
            </p>
          </div>
          <a
            href="/api/windows-bundle/download"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Download Windows Source &amp; Installer Kit (.zip)</span>
          </a>
        </div>
      </div>
    </div>
  );
}
