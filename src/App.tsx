import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { api } from './api';
import { ApiKeyManagerView } from './components/ApiKeyManagerView';
import {
  AsrView,
  HomeDashboardView,
  ImportVideoView,
  SpeakerDetectionView,
  TranslationView,
} from './components/PipelineViews';
import { Sidebar } from './components/Sidebar';
import {
  AudioSyncView,
  ExportMp4View,
  ProjectHistoryView,
  SettingsView,
  VideoPreviewView,
} from './components/StudioMediaViews';
import { TopBar } from './components/TopBar';
import {
  EmotionSettingsView,
  VoiceCloningView,
  VoiceManagementView,
} from './components/VoiceViews';
import type {
  ApiKeyRecord,
  AppSettings,
  BatchExportJob,
  NavSectionId,
  ProjectRecord,
  ProviderPoolStatus,
  SegmentRecord,
  SpeakerRecord,
  VoiceProfileRecord,
} from './types';

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('home');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [speakers, setSpeakers] = useState<SpeakerRecord[]>([]);
  const [voices, setVoices] = useState<VoiceProfileRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [poolStatus, setPoolStatus] = useState<ProviderPoolStatus | null>(null);
  const [exportJobs, setExportJobs] = useState<BatchExportJob[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isPipelinePolling, setIsPipelinePolling] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const loadGlobalData = useCallback(async () => {
    try {
      const [projRes, voicesRes, keysRes, settingsRes, exportsRes] = await Promise.all([
        api.listProjects(),
        api.listVoices(),
        api.listKeys(),
        api.getSettings(),
        api.listExports(),
      ]);
      setProjects(projRes.projects);
      setVoices(voicesRes.voices);
      setKeys(keysRes.keys);
      setPoolStatus(keysRes.poolStatus);
      setSettings(settingsRes.settings);
      setExportJobs(exportsRes.jobs);

      if (!activeProjectId && projRes.projects.length > 0) {
        setActiveProjectId(projRes.projects[0].id);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  }, [activeProjectId]);

  const loadActiveProject = useCallback(async (projectId: string) => {
    try {
      const res = await api.getProject(projectId);
      setActiveProject(res.project);
      setSegments(res.segments);
      setSpeakers(res.speakers);
      return res.project;
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadGlobalData();
  }, [loadGlobalData]);

  useEffect(() => {
    if (activeProjectId) {
      void loadActiveProject(activeProjectId);
    } else {
      setActiveProject(null);
      setSegments([]);
      setSpeakers([]);
    }
  }, [activeProjectId, loadActiveProject]);

  // Poll project while auto-dubbing pipeline is running
  useEffect(() => {
    if (!isPipelinePolling || !activeProjectId) return;
    const timer = setInterval(async () => {
      const proj = await loadActiveProject(activeProjectId);
      if (proj && (proj.status === 'mixed' || proj.status === 'exported' || proj.status === 'error')) {
        setIsPipelinePolling(false);
        const list = await api.listProjects();
        setProjects(list.projects);
        const keyData = await api.listKeys();
        setPoolStatus(keyData.poolStatus);
        if (proj.status === 'error' && proj.errorMessage) {
          setErrorBanner(proj.errorMessage);
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [isPipelinePolling, activeProjectId, loadActiveProject]);

  const handleImportFile = async (file: File, name: string, sourceLanguage: string) => {
    setErrorBanner(null);
    try {
      const fd = new FormData();
      fd.append('video', file);
      fd.append('name', name);
      fd.append('sourceLanguage', sourceLanguage);
      const res = await api.importVideo(fd);
      await loadGlobalData();
      setActiveProjectId(res.project.id);
      await loadActiveProject(res.project.id);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateDemo = async () => {
    setErrorBanner(null);
    try {
      const res = await api.createDemoProject();
      await loadGlobalData();
      setActiveProjectId(res.project.id);
      await loadActiveProject(res.project.id);
      setActiveSection('import');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStartAutoDub = async () => {
    if (!activeProjectId) return;
    setErrorBanner(null);
    try {
      await api.startAutoDub(activeProjectId);
      setIsPipelinePolling(true);
      await loadActiveProject(activeProjectId);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunStage = async (stage: 'asr' | 'diarize' | 'translate' | 'tts' | 'mix') => {
    if (!activeProjectId) return;
    setErrorBanner(null);
    try {
      await api.runStage(activeProjectId, stage);
      await loadActiveProject(activeProjectId);
      const list = await api.listProjects();
      setProjects(list.projects);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateProject = async (patch: Partial<ProjectRecord>) => {
    if (!activeProjectId) return;
    try {
      const res = await api.updateProject(activeProjectId, patch);
      setActiveProject(res.project);
      setProjects((prev) => prev.map((p) => (p.id === res.project.id ? res.project : p)));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateSegment = async (segId: string, patch: Partial<SegmentRecord>) => {
    if (!activeProjectId) return;
    try {
      const res = await api.updateSegment(activeProjectId, segId, patch);
      setSegments((prev) => prev.map((s) => (s.id === segId ? res.segment : s)));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSynthesizeSegment = async (segId: string) => {
    if (!activeProjectId) return;
    setErrorBanner(null);
    try {
      const res = await api.synthesizeSegment(activeProjectId, segId);
      setSegments((prev) => prev.map((s) => (s.id === segId ? res.segment : s)));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateSpeaker = async (speakerRowId: string, patch: Partial<SpeakerRecord>) => {
    if (!activeProjectId) return;
    try {
      const res = await api.updateSpeaker(activeProjectId, speakerRowId, patch);
      setSpeakers((prev) => prev.map((sp) => (sp.id === speakerRowId ? res.speaker : sp)));
      setSegments(res.segments);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteProject = async (id: string) => {
    await api.deleteProject(id);
    const list = await api.listProjects();
    setProjects(list.projects);
    if (activeProjectId === id) {
      setActiveProjectId(list.projects[0]?.id ?? null);
    }
  };

  const handleRefreshKeys = async () => {
    const res = await api.listKeys();
    setKeys(res.keys);
    setPoolStatus(res.poolStatus);
  };

  const handleRefreshVoices = async () => {
    const res = await api.listVoices();
    setVoices(res.voices);
  };

  const handleRefreshExports = useCallback(async () => {
    const res = await api.listExports();
    setExportJobs(res.jobs);
  }, []);

  const handleTriggerExport = async (payload: {
    projectId: string;
    resolution: '720p' | '1080p' | '4k' | 'original';
    codec: 'h264' | 'h265';
    exportSrt: boolean;
  }) => {
    setErrorBanner(null);
    try {
      await api.createExport(payload);
      await handleRefreshExports();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    const res = await api.updateSettings(patch);
    setSettings(res.settings);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      <Sidebar activeSection={activeSection} onSelect={setActiveSection} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeSection={activeSection}
          activeProject={activeProject}
          isBusy={isPipelinePolling}
          onStartAutoDub={handleStartAutoDub}
          onGoToExport={() => setActiveSection('export')}
        />

        {errorBanner && (
          <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 flex items-start justify-between gap-3 text-xs text-red-300">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span className="break-words leading-relaxed">{errorBanner}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(errorBanner.includes('429') || errorBanner.toLowerCase().includes('rate limit') || errorBanner.toLowerCase().includes('quota')) && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('gemini-keys');
                    setErrorBanner(null);
                  }}
                  className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 font-medium whitespace-nowrap"
                >
                  Open Gemini Keys
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-red-300 hover:text-white shrink-0 mt-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'home' && (
            <HomeDashboardView
              activeProject={activeProject}
              projects={projects}
              poolStatus={poolStatus}
              segmentsCount={segments.length}
              speakersCount={speakers.length}
              onSelectProject={(id) => setActiveProjectId(id)}
              onNavigate={setActiveSection}
              onCreateDemo={handleCreateDemo}
              onStartAutoDub={handleStartAutoDub}
            />
          )}

          {activeSection === 'import' && (
            <ImportVideoView
              activeProject={activeProject}
              onImportFile={handleImportFile}
              onCreateDemo={handleCreateDemo}
              onUpdateProjectConfig={handleUpdateProject}
              onStartAutoDub={handleStartAutoDub}
            />
          )}

          {activeSection === 'asr' && (
            <AsrView
              activeProject={activeProject}
              segments={segments}
              onRunAsr={() => handleRunStage('asr')}
              onUpdateSegment={handleUpdateSegment}
            />
          )}

          {activeSection === 'translation' && (
            <TranslationView
              activeProject={activeProject}
              segments={segments}
              onRunTranslation={() => handleRunStage('translate')}
              onUpdateSegment={handleUpdateSegment}
            />
          )}

          {activeSection === 'speakers' && (
            <SpeakerDetectionView
              activeProject={activeProject}
              speakers={speakers}
              segments={segments}
              voices={voices}
              onRunDiarization={() => handleRunStage('diarize')}
              onUpdateSpeaker={handleUpdateSpeaker}
              onUpdateSegment={handleUpdateSegment}
            />
          )}

          {activeSection === 'voices' && (
            <VoiceManagementView
              voices={voices}
              activeProject={activeProject}
              onRunTtsAll={() => handleRunStage('tts')}
            />
          )}

          {activeSection === 'cloning' && (
            <VoiceCloningView voices={voices} onRefreshVoices={handleRefreshVoices} />
          )}

          {activeSection === 'emotions' && (
            <EmotionSettingsView
              activeProject={activeProject}
              segments={segments}
              onUpdateSegment={handleUpdateSegment}
              onSynthesizeSegment={handleSynthesizeSegment}
            />
          )}

          {activeSection === 'gemini-keys' && (
            <ApiKeyManagerView
              provider="gemini"
              keys={keys}
              poolStatus={poolStatus}
              onRefresh={handleRefreshKeys}
            />
          )}

          {activeSection === 'groq-keys' && (
            <ApiKeyManagerView
              provider="groq"
              keys={keys}
              poolStatus={poolStatus}
              onRefresh={handleRefreshKeys}
            />
          )}

          {activeSection === 'audio-sync' && (
            <AudioSyncView
              activeProject={activeProject}
              segments={segments}
              onUpdateProject={handleUpdateProject}
              onRunMix={() => handleRunStage('mix')}
            />
          )}

          {activeSection === 'preview' && (
            <VideoPreviewView activeProject={activeProject} segments={segments} />
          )}

          {activeSection === 'export' && (
            <ExportMp4View
              activeProject={activeProject}
              projects={projects}
              exportJobs={exportJobs}
              onTriggerExport={handleTriggerExport}
              onRefreshJobs={handleRefreshExports}
            />
          )}

          {activeSection === 'history' && (
            <ProjectHistoryView
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={(id) => setActiveProjectId(id)}
              onDeleteProject={handleDeleteProject}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView settings={settings} onUpdateSettings={handleUpdateSettings} />
          )}
        </main>
      </div>
    </div>
  );
}
