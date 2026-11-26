import { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileAudio,
  Film,
  Languages,
  Loader2,
  Play,
  RefreshCw,
  Upload,
  Users,
  Wand2,
} from 'lucide-react';
import type {
  AsrEngineOption,
  GeminiModelOption,
  NavSectionId,
  ProjectRecord,
  ProviderPoolStatus,
  SegmentRecord,
  SpeakerRecord,
  VoiceProfileRecord,
} from '../types';

export function formatSec(sec: number): string {
  const s = Math.max(0, sec);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${ms}`;
}

interface HomeViewProps {
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  poolStatus: ProviderPoolStatus | null;
  segmentsCount: number;
  speakersCount: number;
  onSelectProject: (id: string) => void;
  onNavigate: (section: NavSectionId) => void;
  onCreateDemo: () => Promise<void>;
  onStartAutoDub: () => void;
}

export function HomeDashboardView({
  activeProject,
  projects,
  poolStatus,
  segmentsCount,
  speakersCount,
  onSelectProject,
  onNavigate,
  onCreateDemo,
  onStartAutoDub,
}: HomeViewProps) {
  const [creatingDemo, setCreatingDemo] = useState(false);

  const handleDemo = async () => {
    setCreatingDemo(true);
    try {
      await onCreateDemo();
    } finally {
      setCreatingDemo(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="bg-[#121826] border border-white/8 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="text-xs font-medium text-amber-400">
            Automatic Khmer Video Dubbing Studio
          </div>
          <h1 className="text-2xl font-display font-semibold text-slate-100 text-balance">
            Convert Any Language Video into Expressive Khmer Dubbing Automatically
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Import a video, run automatic speech recognition and character speaker detection,
            translate story dialogue naturally into Khmer with emotional acting, and export a
            synchronized MP4 with preserved background music.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('import')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Import Video</span>
          </button>

          <button
            type="button"
            disabled={creatingDemo}
            onClick={handleDemo}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-100 border border-white/10 hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {creatingDemo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            <span>{creatingDemo ? 'Generating Demo MP4...' : 'Create Two-Speaker Demo'}</span>
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#121826] border border-white/8 rounded-xl p-5">
          <div className="text-xs text-slate-400">Active Project</div>
          <div className="mt-1.5 text-base font-display font-semibold text-slate-100 truncate">
            {activeProject ? activeProject.name : 'No Video Loaded'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {activeProject
              ? `${activeProject.width}x${activeProject.height} · ${activeProject.durationSec.toFixed(1)}s`
              : 'Import MP4, MKV, MOV, or AVI'}
          </div>
        </div>

        <div className="bg-[#121826] border border-white/8 rounded-xl p-5">
          <div className="text-xs text-slate-400">Dialogue &amp; Speakers</div>
          <div className="mt-1.5 text-base font-display font-semibold text-slate-100 font-mono tabular-nums">
            {segmentsCount} lines · {speakersCount} speakers
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {activeProject?.sourceLanguage && activeProject.sourceLanguage !== 'auto'
              ? `Detected language: ${activeProject.sourceLanguage}`
              : 'Auto language detection ready'}
          </div>
        </div>

        <div className="bg-[#121826] border border-white/8 rounded-xl p-5">
          <div className="text-xs text-slate-400">Gemini AI Translation</div>
          <div className="mt-1.5 text-base font-display font-semibold text-slate-100">
            {poolStatus?.gemini.hasAnyReady ? 'Connected & Ready' : 'Waiting for Key'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {poolStatus?.gemini.envConfigured ? 'Server Env Active' : 'No Env'} · {poolStatus?.gemini.activePoolKeys ?? 0} pool keys
          </div>
        </div>

        <div className="bg-[#121826] border border-white/8 rounded-xl p-5">
          <div className="text-xs text-slate-400">Groq Whisper ASR</div>
          <div className="mt-1.5 text-base font-display font-semibold text-slate-100">
            {poolStatus?.groq.hasAnyReady ? 'Groq Whisper Ready' : 'Gemini Fallback Ready'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {poolStatus?.groq.activePoolKeys ?? 0} Groq rotation keys configured
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#121826] border border-white/8 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-display font-semibold text-slate-100">
              6-Step Automatic Dubbing Workflow
            </h2>
            {activeProject && (
              <button
                type="button"
                onClick={onStartAutoDub}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run All Steps Now</span>
              </button>
            )}
          </div>

          <div className="divide-y divide-white/6 text-sm">
            {[
              { step: '01', title: 'Import & Analyze Video', desc: 'Reads video streams, FPS, resolution, and extracts embedded subtitles if present.', nav: 'import' as NavSectionId },
              { step: '02', title: 'Groq Whisper / Audio Speech Recognition', desc: 'Splits long videos into audio chunks and transcribes timestamped dialogue automatically.', nav: 'asr' as NavSectionId },
              { step: '03', title: 'Speaker Detection & Character Voices', desc: 'Separates speakers, detects gender characteristics, and locks consistent voices per character.', nav: 'speakers' as NavSectionId },
              { step: '04', title: 'Gemini Contextual Khmer Translation & Emotion', desc: 'Translates natural Khmer dialogue while preserving story names and tagging 12 emotions.', nav: 'translation' as NavSectionId },
              { step: '05', title: 'Khmer Voice Synthesis & Audio Mixing', desc: 'Generates expressive Khmer audio, fits timing to avoid overlap, and mixes with background music.', nav: 'audio-sync' as NavSectionId },
              { step: '06', title: 'Preview & Export MP4', desc: 'Inspect synced video preview and export 720p, 1080p, or 4K MP4 plus Khmer .srt subtitles.', nav: 'export' as NavSectionId },
            ].map((row) => (
              <div key={row.step} className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-mono text-xs text-amber-400 tabular-nums shrink-0">{row.step}.</span>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100">{row.title}</div>
                    <div className="text-xs text-slate-400">{row.desc}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate(row.nav)}
                  className="text-xs font-medium text-slate-300 hover:text-amber-400 whitespace-nowrap shrink-0"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#121826] border border-white/8 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-3">
            <div className="text-xs font-medium text-amber-400">Windows 10 / 11 Desktop Edition</div>
            <h2 className="text-base font-display font-semibold text-slate-100">
              AI_Khmer_Dubber_Pro_Setup.exe Package
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Download the complete Python 3.11 + PySide6 desktop source code, PyInstaller spec,
              Inno Setup script, and GitHub Actions workflow to build the native Windows installer
              automatically in the cloud without installing Python locally.
            </p>
          </div>

          <div className="space-y-3">
            <a
              href="/api/windows-bundle/download"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-100 border border-white/10 hover:bg-slate-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download Windows Desktop &amp; Installer Kit (.zip)</span>
            </a>

            {projects.length > 0 && (
              <div className="pt-3 border-t border-white/8 space-y-2">
                <div className="text-xs font-medium text-slate-400">Recent Projects</div>
                {projects.slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectProject(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between gap-2 ${
                      activeProject?.id === p.id
                        ? 'bg-slate-800 text-amber-400'
                        : 'hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">{p.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface ImportViewProps {
  activeProject: ProjectRecord | null;
  onImportFile: (file: File, name: string, sourceLang: string) => Promise<void>;
  onCreateDemo: () => Promise<void>;
  onUpdateProjectConfig: (patch: Partial<ProjectRecord>) => Promise<void>;
  onStartAutoDub: () => void;
}

export function ImportVideoView({
  activeProject,
  onImportFile,
  onCreateDemo,
  onUpdateProjectConfig,
  onStartAutoDub,
}: ImportViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [uploading, setUploading] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      await onImportFile(selectedFile, projectName || selectedFile.name.replace(/\.[^/.]+$/, ''), sourceLang);
      setSelectedFile(null);
      setProjectName('');
    } finally {
      setUploading(false);
    }
  };

  const handleDemo = async () => {
    setDemoBusy(true);
    try {
      await onCreateDemo();
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-display font-semibold text-slate-100">
            Import Video for Automatic Khmer Dubbing
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Supports MP4, MKV, MOV, AVI, and WebM. Embedded subtitles are automatically extracted when available; otherwise speech recognition runs automatically.
          </p>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) {
              setSelectedFile(f);
              setProjectName(f.name.replace(/\.[^/.]+$/, ''));
            }
          }}
          className="border border-dashed border-slate-700 hover:border-amber-500/60 bg-[#0B0F17]/60 rounded-xl p-8 text-center cursor-pointer transition-colors"
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv,.avi,.mov,.mp4,.webm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setSelectedFile(f);
                setProjectName(f.name.replace(/\.[^/.]+$/, ''));
              }
            }}
          />
          <Film className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <div className="text-sm font-medium text-slate-200">
            {selectedFile ? selectedFile.name : 'Click to browse or drag and drop a video file'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {selectedFile
              ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB ready to upload & analyze`
              : 'MP4, MKV, MOV, AVI, WebM up to 1 GB'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Project Title</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Episode 01 Khmer Dub"
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Source Spoken Language</label>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
            >
              <option value="auto">Auto-Detect Any Language</option>
              <option value="en">English (en)</option>
              <option value="zh">Chinese (zh)</option>
              <option value="th">Thai (th)</option>
              <option value="vi">Vietnamese (vi)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="ko">Korean (ko)</option>
              <option value="fr">French (fr)</option>
              <option value="es">Spanish (es)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={!selectedFile || uploading}
            onClick={handleUpload}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>{uploading ? 'Uploading & Probing...' : 'Upload & Analyze Video'}</span>
          </button>

          <button
            type="button"
            disabled={demoBusy}
            onClick={handleDemo}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-100 border border-white/10 hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {demoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            <span>{demoBusy ? 'Generating Two-Speaker Demo...' : 'Generate Two-Speaker Demo Video'}</span>
          </button>
        </div>
      </div>

      {activeProject && (
        <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-display font-semibold text-slate-100">
                Loaded Video Analysis: {activeProject.name}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                {activeProject.originalFilename} · {activeProject.width}x{activeProject.height} · {activeProject.fps} fps · {activeProject.durationSec.toFixed(2)}s · Embedded Subtitles: {activeProject.hasEmbeddedSubtitles ? 'Yes' : 'No (Auto ASR)'}
              </p>
            </div>
            <button
              type="button"
              onClick={onStartAutoDub}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>START AUTO DUBBING</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/8">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Speech Recognition Engine</label>
              <select
                value={activeProject.asrEngine}
                onChange={(e) => onUpdateProjectConfig({ asrEngine: e.target.value as AsrEngineOption })}
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="auto">Auto (Groq Whisper if key ready, else Gemini Audio)</option>
                <option value="groq-whisper">Groq Whisper (whisper-large-v3-turbo)</option>
                <option value="gemini-transcribe">Gemini Audio Transcription</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Gemini Translation Model</label>
              <select
                value={activeProject.targetGeminiModel}
                onChange={(e) => onUpdateProjectConfig({ targetGeminiModel: e.target.value as GeminiModelOption })}
                className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Fast &amp; Accurate)</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (High Speed)</option>
                <option value="gemini-4-neon">Gemini 4 Neon (Deep Story Context)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AsrViewProps {
  activeProject: ProjectRecord | null;
  segments: SegmentRecord[];
  onRunAsr: () => Promise<void>;
  onUpdateSegment: (segId: string, patch: Partial<SegmentRecord>) => Promise<void>;
}

export function AsrView({ activeProject, segments, onRunAsr, onUpdateSegment }: AsrViewProps) {
  const [running, setRunning] = useState(false);

  if (!activeProject) {
    return (
      <div className="bg-[#121826] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
        Import a video first to extract subtitles or run Groq Whisper speech recognition.
      </div>
    );
  }

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunAsr();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-100">
            Automatic Speech Recognition &amp; Subtitle Extraction
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Long videos are automatically split into audio chunks, transcribed with timestamps, and optionally reviewed here before Khmer dubbing.
          </p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={handleRun}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileAudio className="w-4 h-4" />}
          <span>{running ? 'Transcribing Audio...' : 'Run Speech Recognition'}</span>
        </button>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 flex items-center justify-between text-xs text-slate-400">
          <span>Recognized Dialogue ({segments.length} segments)</span>
          <span className="font-mono">Source Language: {activeProject.sourceLanguage}</span>
        </div>

        {segments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No subtitles extracted yet. Click &ldquo;Run Speech Recognition&rdquo; or &ldquo;START AUTO DUBBING&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E131F] text-xs text-slate-400 border-b border-white/8">
                <tr>
                  <th className="py-2.5 px-4 font-medium w-12">#</th>
                  <th className="py-2.5 px-4 font-medium w-36">Timeline</th>
                  <th className="py-2.5 px-4 font-medium w-32">Speaker</th>
                  <th className="py-2.5 px-4 font-medium">Recognized Dialogue (Editable)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {segments.map((seg) => (
                  <tr key={seg.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">{seg.idx + 1}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                      {formatSec(seg.startTime)} - {formatSec(seg.endTime)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-amber-400">{seg.speakerId}</td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        defaultValue={seg.sourceText}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== seg.sourceText) {
                            void onUpdateSegment(seg.id, { sourceText: v });
                          }
                        }}
                        className="w-full bg-transparent border border-transparent focus:border-white/15 focus:bg-[#0B0F17] rounded px-2 py-1 text-slate-200 text-sm focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface TranslationViewProps {
  activeProject: ProjectRecord | null;
  segments: SegmentRecord[];
  onRunTranslation: () => Promise<void>;
  onUpdateSegment: (segId: string, patch: Partial<SegmentRecord>) => Promise<void>;
}

export function TranslationView({
  activeProject,
  segments,
  onRunTranslation,
  onUpdateSegment,
}: TranslationViewProps) {
  const [running, setRunning] = useState(false);

  if (!activeProject) {
    return (
      <div className="bg-[#121826] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
        Import and transcribe a video first to generate contextual Khmer translations.
      </div>
    );
  }

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunTranslation();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-base font-display font-semibold text-slate-100">
            Gemini AI Contextual Khmer Translation
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {activeProject.storySummary
              ? `Story Context: ${activeProject.storySummary}`
              : 'Translates dialogue chronologically while maintaining character names, relationships, and natural spoken Khmer.'}
          </p>
        </div>
        <button
          type="button"
          disabled={running || segments.length === 0}
          onClick={handleRun}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
          <span>{running ? 'Translating to Khmer...' : 'Translate All to Khmer'}</span>
        </button>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
        {segments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Run speech recognition first to populate source dialogue lines.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E131F] text-xs text-slate-400 border-b border-white/8">
                <tr>
                  <th className="py-2.5 px-4 font-medium w-28">Time</th>
                  <th className="py-2.5 px-4 font-medium w-28">Emotion</th>
                  <th className="py-2.5 px-4 font-medium w-1/3">Original Dialogue</th>
                  <th className="py-2.5 px-4 font-medium">Natural Khmer Translation (ភាសាខ្មែរ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {segments.map((seg) => (
                  <tr key={seg.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                      {formatSec(seg.startTime)}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-amber-400 font-medium">{seg.emotion}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-300">{seg.sourceText}</td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        defaultValue={seg.khmerText}
                        placeholder="Khmer translation will appear here..."
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== seg.khmerText) {
                            void onUpdateSegment(seg.id, { khmerText: v });
                          }
                        }}
                        className="w-full khmer-text bg-transparent border border-transparent focus:border-white/15 focus:bg-[#0B0F17] rounded px-2 py-1 text-slate-100 text-sm focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface SpeakersViewProps {
  activeProject: ProjectRecord | null;
  speakers: SpeakerRecord[];
  segments: SegmentRecord[];
  voices: VoiceProfileRecord[];
  onRunDiarization: () => Promise<void>;
  onUpdateSpeaker: (speakerRowId: string, patch: Partial<SpeakerRecord>) => Promise<void>;
  onUpdateSegment: (segId: string, patch: Partial<SegmentRecord>) => Promise<void>;
}

export function SpeakerDetectionView({
  activeProject,
  speakers,
  segments,
  voices,
  onRunDiarization,
  onUpdateSpeaker,
  onUpdateSegment,
}: SpeakersViewProps) {
  const [running, setRunning] = useState(false);

  if (!activeProject) {
    return (
      <div className="bg-[#121826] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
        Import and transcribe a video first to detect speakers and assign consistent character voices.
      </div>
    );
  }

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunDiarization();
    } finally {
      setRunning(false);
    }
  };

  const clonedVoices = voices.filter((v) => v.isCloned);

  return (
    <div className="space-y-6">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-100">
            AI Speaker Diarization &amp; Character Voice Mapping
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatically detects distinct characters, identifies gender traits, and locks the same Khmer voice to each character throughout the video.
          </p>
        </div>
        <button
          type="button"
          disabled={running || segments.length === 0}
          onClick={handleRun}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          <span>{running ? 'Detecting Speakers...' : 'Detect Speakers'}</span>
        </button>
      </div>

      {speakers.length > 0 && (
        <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/8 text-xs font-medium text-slate-400">
            Detected Characters ({speakers.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E131F] text-xs text-slate-400 border-b border-white/8">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Speaker ID</th>
                  <th className="py-2.5 px-4 font-medium">Character Name</th>
                  <th className="py-2.5 px-4 font-medium">Gender</th>
                  <th className="py-2.5 px-4 font-medium">Assigned Khmer Voice</th>
                  <th className="py-2.5 px-4 font-medium">Cloned Voice Profile</th>
                  <th className="py-2.5 px-4 font-medium text-right">Lines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {speakers.map((sp) => (
                  <tr key={sp.id}>
                    <td className="py-2.5 px-4 font-mono text-xs text-amber-400">{sp.speakerId}</td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        defaultValue={sp.displayName}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== sp.displayName) {
                            void onUpdateSpeaker(sp.id, { displayName: v });
                          }
                        }}
                        className="bg-[#0B0F17] border border-white/10 rounded px-2.5 py-1 text-xs text-slate-100"
                      />
                    </td>
                    <td className="py-2 px-4">
                      <select
                        value={sp.gender}
                        onChange={(e) =>
                          void onUpdateSpeaker(sp.id, {
                            gender: e.target.value as SpeakerRecord['gender'],
                          })
                        }
                        className="bg-[#0B0F17] border border-white/10 rounded px-2.5 py-1 text-xs text-slate-200"
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="neutral">Neutral</option>
                      </select>
                    </td>
                    <td className="py-2 px-4">
                      <select
                        value={sp.assignedVoice}
                        onChange={(e) =>
                          void onUpdateSpeaker(sp.id, { assignedVoice: e.target.value, clonedVoiceId: null })
                        }
                        className="bg-[#0B0F17] border border-white/10 rounded px-2.5 py-1 text-xs text-slate-200"
                      >
                        <option value="Kore">Sophea — Warm Female (Kore)</option>
                        <option value="Zephyr">Bopha — Bright Female (Zephyr)</option>
                        <option value="Puck">Dara — Dynamic Male (Puck)</option>
                        <option value="Charon">Vannak — Deep Male (Charon)</option>
                        <option value="Fenrir">Rithy — Intense Male (Fenrir)</option>
                      </select>
                    </td>
                    <td className="py-2 px-4">
                      <select
                        value={sp.clonedVoiceId ?? ''}
                        onChange={(e) =>
                          void onUpdateSpeaker(sp.id, {
                            clonedVoiceId: e.target.value || null,
                          })
                        }
                        className="bg-[#0B0F17] border border-white/10 rounded px-2.5 py-1 text-xs text-slate-200"
                      >
                        <option value="">None (Use Standard Voice)</option>
                        {clonedVoices.map((cv) => (
                          <option key={cv.id} value={cv.id}>
                            {cv.name} ({cv.gender})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-400 tabular-nums">
                      {sp.lineCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {segments.length > 0 && speakers.length > 0 && (
        <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/8 flex items-center justify-between text-xs text-slate-400">
            <span>Manual Per-Line Speaker Assignment</span>
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Changes persist automatically
            </span>
          </div>
          <div className="divide-y divide-white/6 max-h-[380px] overflow-y-auto">
            {segments.map((seg) => (
              <div key={seg.id} className="px-5 py-2.5 flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-slate-500 tabular-nums shrink-0">
                    {formatSec(seg.startTime)}
                  </span>
                  <span className="text-slate-200 truncate">{seg.khmerText || seg.sourceText}</span>
                </div>
                <select
                  value={seg.speakerId}
                  onChange={(e) => void onUpdateSegment(seg.id, { speakerId: e.target.value })}
                  className="bg-[#0B0F17] border border-white/10 rounded px-2.5 py-1 text-xs text-amber-400 shrink-0"
                >
                  {speakers.map((sp) => (
                    <option key={sp.speakerId} value={sp.speakerId}>
                      {sp.displayName} ({sp.speakerId})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
