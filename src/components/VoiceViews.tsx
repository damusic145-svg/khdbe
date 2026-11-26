import { useRef, useState } from 'react';
import { AudioLines, Loader2, Mic2, Play, RefreshCw, ShieldCheck, Trash2, Upload, Volume2 } from 'lucide-react';
import type { EmotionType, ProjectRecord, SegmentRecord, VoiceProfileRecord } from '../types';
import { SUPPORTED_EMOTIONS } from '../types';
import { api } from '../api';
import { formatSec } from './PipelineViews';

interface VoiceManagementProps {
  voices: VoiceProfileRecord[];
  activeProject: ProjectRecord | null;
  onRunTtsAll: () => Promise<void>;
}

export function VoiceManagementView({ voices, activeProject, onRunTtsAll }: VoiceManagementProps) {
  const [previewText, setPreviewText] = useState(
    'សួស្តី! នេះគឺជាការសាកល្បងសំឡេងបញ្ចូលខ្មែរដោយស្វ័យប្រវត្តិ។'
  );
  const [previewEmotion, setPreviewEmotion] = useState<EmotionType>('Happy');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreview = async (id: string) => {
    setLoadingId(id);
    setPreviewError(null);
    try {
      const url = await api.previewVoice(id, previewText, previewEmotion);
      setAudioUrl(url);
      const a = new Audio(url);
      void a.play();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingId(null);
    }
  };

  const handleSynthesizeAll = async () => {
    setRunningAll(true);
    setPreviewError(null);
    try {
      await onRunTtsAll();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-100">
            AI Khmer Voice Library &amp; Preview
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audition male, female, and cloned Khmer voices with any emotion before generating your final dubbed video.
          </p>
        </div>

        {activeProject && (
          <button
            type="button"
            disabled={runningAll}
            onClick={handleSynthesizeAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic2 className="w-4 h-4" />}
            <span>{runningAll ? 'Synthesizing All Lines...' : 'Generate All Khmer Voices'}</span>
          </button>
        )}
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5">Khmer Preview Line</label>
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            className="w-full khmer-text bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Test Emotion</label>
          <select
            value={previewEmotion}
            onChange={(e) => setPreviewEmotion(e.target.value as EmotionType)}
            className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
          >
            {SUPPORTED_EMOTIONS.map((em) => (
              <option key={em} value={em}>
                {em}
              </option>
            ))}
          </select>
        </div>
      </div>

      {previewError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-3 text-xs text-red-300">
          {previewError}
        </div>
      )}

      {audioUrl && (
        <div className="bg-[#121826] border border-white/8 rounded-xl px-5 py-3 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-300">Latest Voice Audition Clip</span>
          <audio src={audioUrl} controls className="h-8 max-w-md w-full" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {voices.map((voice) => (
          <div
            key={voice.id}
            className="bg-[#121826] border border-white/8 rounded-xl p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-1.5">
              <div className="text-sm font-display font-semibold text-slate-100">{voice.name}</div>
              <div className="text-xs text-slate-400 font-mono">
                {voice.gender} · {voice.baseVoice} · {voice.isCloned ? 'Cloned Profile' : 'Studio Voice'}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed pt-1">{voice.description}</p>
            </div>

            <button
              type="button"
              disabled={loadingId === voice.id}
              onClick={() => void handlePreview(voice.id)}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-100 border border-white/10 hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingId === voice.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>{loadingId === voice.id ? 'Synthesizing...' : 'Preview Khmer Voice'}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface VoiceCloningProps {
  voices: VoiceProfileRecord[];
  onRefreshVoices: () => Promise<void>;
}

export function VoiceCloningView({ voices, onRefreshVoices }: VoiceCloningProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const cloned = voices.filter((v) => v.isCloned);

  const handleCreate = async () => {
    if (!file || !consent) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append('sample', file);
      fd.append('name', name || file.name.replace(/\.[^/.]+$/, ''));
      fd.append('description', description || 'Authorized custom voice profile');
      fd.append('consentConfirmed', 'true');
      await api.cloneVoice(fd);
      setFile(null);
      setName('');
      setDescription('');
      setConsent(false);
      await onRefreshVoices();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteVoice(id);
    await onRefreshVoices();
  };

  const handlePreview = async (id: string) => {
    setPreviewingId(id);
    try {
      const url = await api.previewVoice(
        id,
        'សួស្តី! នេះគឺជាសំឡេងដែលបានបង្កើតចេញពីគំរូសំឡេងរបស់អ្នក។',
        'Calm'
      );
      const a = new Audio(url);
      void a.play();
    } finally {
      setPreviewingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-100">
              Authorized Voice Cloning Studio
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Upload a clean 5–30 second voice sample that you own or have explicit permission to use. AI analyzes vocal timbre, pitch register, and cadence to build a reusable Khmer dubbing profile.
            </p>
          </div>
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Voice Profile Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Narrator Voice"
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Notes / Character Archetype</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Documentary warm baritone"
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        <div
          onClick={() => fileRef.current?.click()}
          className="border border-dashed border-slate-700 hover:border-amber-500/60 bg-[#0B0F17]/60 rounded-xl p-6 text-center cursor-pointer transition-colors"
        >
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                if (!name) setName(f.name.replace(/\.[^/.]+$/, ''));
              }
            }}
          />
          <AudioLines className="w-7 h-7 text-amber-400 mx-auto mb-2" />
          <div className="text-sm text-slate-200">
            {file ? file.name : 'Select authorized voice sample (.wav, .mp3, .m4a)'}
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 rounded border-slate-600 accent-amber-500"
          />
          <span>
            I confirm that I own this voice recording or hold explicit authorization from the speaker to create a reusable voice profile. Samples are stored privately on this server.
          </span>
        </label>

        {errorMsg && <div className="text-xs text-red-400">{errorMsg}</div>}

        <button
          type="button"
          disabled={!file || !consent || uploading}
          onClick={handleCreate}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-amber-500 text-[#0B0F17] hover:bg-amber-400 disabled:opacity-45 transition-colors"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          <span>{uploading ? 'Analyzing Sample & Creating Profile...' : 'Create Cloned Voice Profile'}</span>
        </button>
      </div>

      <div className="bg-[#121826] border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 text-xs font-medium text-slate-400">
          Saved Cloned Voice Profiles ({cloned.length})
        </div>
        {cloned.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No custom cloned voices yet. Upload an authorized sample above to assign it to characters in Speaker Detection.
          </div>
        ) : (
          <div className="divide-y divide-white/6">
            {cloned.map((cv) => (
              <div key={cv.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-100">{cv.name}</div>
                  <div className="text-xs text-slate-400 font-mono">
                    {cv.gender} · Base timbre: {cv.baseVoice} · Sample: {cv.sampleDurationSec.toFixed(1)}s
                  </div>
                  <div className="text-xs text-slate-400">{cv.stylePrompt}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={previewingId === cv.id}
                    onClick={() => void handlePreview(cv.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-100 hover:bg-slate-700"
                  >
                    {previewingId === cv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(cv.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                    title="Delete Voice Profile"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface EmotionSettingsProps {
  activeProject: ProjectRecord | null;
  segments: SegmentRecord[];
  onUpdateSegment: (segId: string, patch: Partial<SegmentRecord>) => Promise<void>;
  onSynthesizeSegment: (segId: string) => Promise<void>;
}

export function EmotionSettingsView({
  activeProject,
  segments,
  onUpdateSegment,
  onSynthesizeSegment,
}: EmotionSettingsProps) {
  const [synthBusyId, setSynthBusyId] = useState<string | null>(null);

  const handleResynth = async (segId: string) => {
    setSynthBusyId(segId);
    try {
      await onSynthesizeSegment(segId);
    } finally {
      setSynthBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#121826] border border-white/8 rounded-xl p-5 space-y-3">
        <h2 className="text-base font-display font-semibold text-slate-100">
          Automatic Emotional Voice Acting (12 Emotions)
        </h2>
        <p className="text-xs text-slate-400">
          AI analyzes scene context and adapts Khmer vocal tone, speed, pitch, and expression automatically. You can fine-tune any segment below and re-synthesize immediately.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 text-xs text-amber-400 font-medium">
          {SUPPORTED_EMOTIONS.map((em, i) => (
            <span key={em}>
              {em}
              {i < SUPPORTED_EMOTIONS.length - 1 ? <span className="text-slate-600 ml-4">·</span> : null}
            </span>
          ))}
        </div>
      </div>

      {!activeProject || segments.length === 0 ? (
        <div className="bg-[#121826] border border-white/8 rounded-xl p-8 text-center text-sm text-slate-400">
          Run speech recognition and translation on a project to customize line-by-line emotional voice acting.
        </div>
      ) : (
        <div className="bg-[#121826] border border-white/8 rounded-xl divide-y divide-white/6">
          {segments.map((seg) => (
            <div key={seg.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-3 text-xs font-mono text-slate-400 tabular-nums">
                  <span>{formatSec(seg.startTime)}</span>
                  <span className="text-amber-400">{seg.speakerId}</span>
                  <span>Voice: {seg.voiceName}</span>
                </div>
                <div className="khmer-text text-sm text-slate-100">
                  {seg.khmerText || seg.sourceText}
                </div>
                {seg.actingNotes && (
                  <div className="text-xs text-slate-500">Direction: {seg.actingNotes}</div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <select
                  value={seg.emotion}
                  onChange={(e) => void onUpdateSegment(seg.id, { emotion: e.target.value as EmotionType })}
                  className="bg-[#0B0F17] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                >
                  {SUPPORTED_EMOTIONS.map((em) => (
                    <option key={em} value={em}>
                      {em}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums">
                  <span>Speed</span>
                  <input
                    type="number"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    defaultValue={seg.speechSpeed}
                    onBlur={(e) =>
                      void onUpdateSegment(seg.id, { speechSpeed: Number(e.target.value) || 1.0 })
                    }
                    className="w-16 bg-[#0B0F17] border border-white/10 rounded px-2 py-1 text-xs text-slate-100"
                  />
                </label>

                <label className="flex items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums">
                  <span>Pitch</span>
                  <input
                    type="number"
                    min="-6"
                    max="6"
                    step="0.5"
                    defaultValue={seg.pitchShift}
                    onBlur={(e) =>
                      void onUpdateSegment(seg.id, { pitchShift: Number(e.target.value) || 0 })
                    }
                    className="w-14 bg-[#0B0F17] border border-white/10 rounded px-2 py-1 text-xs text-slate-100"
                  />
                </label>

                <button
                  type="button"
                  disabled={synthBusyId === seg.id}
                  onClick={() => void handleResynth(seg.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                >
                  {synthBusyId === seg.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Re-Voice</span>
                </button>

                {seg.ttsAudioPath && (
                  <button
                    type="button"
                    onClick={() => {
                      const audio = new Audio(
                        `/api/projects/${activeProject.id}/segments/${seg.id}/audio?t=${Date.now()}`
                      );
                      void audio.play();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
