import type {
  ApiKeyRecord,
  AppSettings,
  BatchExportJob,
  EmotionType,
  ProjectRecord,
  ProviderPoolStatus,
  SegmentRecord,
  SpeakerRecord,
  VoiceProfileRecord,
} from './types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  getSettings(): Promise<{ settings: AppSettings; poolStatus: ProviderPoolStatus }> {
    return requestJson('/api/settings');
  },

  updateSettings(patch: Partial<AppSettings>): Promise<{ settings: AppSettings }> {
    return requestJson('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  listKeys(provider?: 'gemini' | 'groq'): Promise<{ keys: ApiKeyRecord[]; poolStatus: ProviderPoolStatus }> {
    const q = provider ? `?provider=${provider}` : '';
    return requestJson(`/api/keys${q}`);
  },

  addKey(provider: 'gemini' | 'groq', label: string, apiKey: string): Promise<{ key: ApiKeyRecord; poolStatus: ProviderPoolStatus }> {
    return requestJson('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, label, apiKey }),
    });
  },

  updateKey(
    id: string,
    patch: { label?: string; apiKey?: string; isEnabled?: boolean; status?: 'active' | 'disabled' }
  ): Promise<{ key: ApiKeyRecord; poolStatus: ProviderPoolStatus }> {
    return requestJson(`/api/keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  testKey(id: string): Promise<{ ok: boolean; status: string; message: string; keys: ApiKeyRecord[]; poolStatus: ProviderPoolStatus }> {
    return requestJson(`/api/keys/${id}/test`, { method: 'POST' });
  },

  deleteKey(id: string): Promise<{ ok: boolean; poolStatus: ProviderPoolStatus }> {
    return requestJson(`/api/keys/${id}`, { method: 'DELETE' });
  },

  listVoices(): Promise<{ voices: VoiceProfileRecord[] }> {
    return requestJson('/api/voices');
  },

  async cloneVoice(formData: FormData): Promise<{ voice: VoiceProfileRecord }> {
    return requestJson('/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
  },

  async previewVoice(id: string, text: string, emotion: EmotionType): Promise<string> {
    const res = await fetch(`/api/voices/${id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, emotion }),
    });
    if (!res.ok) {
      const errText = await res.text();
      let msg = errText || `Voice preview failed (${res.status})`;
      try {
        const parsed = JSON.parse(errText) as { error?: unknown };
        if (parsed && typeof parsed.error === 'string') {
          msg = parsed.error;
        }
      } catch {
        // use raw text
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  deleteVoice(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/api/voices/${id}`, { method: 'DELETE' });
  },

  listProjects(): Promise<{ projects: ProjectRecord[] }> {
    return requestJson('/api/projects');
  },

  getProject(id: string): Promise<{ project: ProjectRecord; segments: SegmentRecord[]; speakers: SpeakerRecord[] }> {
    return requestJson(`/api/projects/${id}`);
  },

  importVideo(formData: FormData): Promise<{ project: ProjectRecord }> {
    return requestJson('/api/projects/import', {
      method: 'POST',
      body: formData,
    });
  },

  createDemoProject(): Promise<{ project: ProjectRecord }> {
    return requestJson('/api/projects/create-demo', { method: 'POST' });
  },

  updateProject(id: string, patch: Partial<ProjectRecord>): Promise<{ project: ProjectRecord }> {
    return requestJson(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  deleteProject(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/api/projects/${id}`, { method: 'DELETE' });
  },

  startAutoDub(id: string): Promise<{ started: boolean; projectId: string }> {
    return requestJson(`/api/projects/${id}/auto-dub`, { method: 'POST' });
  },

  runStage(id: string, stage: 'asr' | 'diarize' | 'translate' | 'tts' | 'mix'): Promise<{ project: ProjectRecord }> {
    return requestJson(`/api/projects/${id}/stage/${stage}`, { method: 'POST' });
  },

  updateSegment(projectId: string, segId: string, patch: Partial<SegmentRecord>): Promise<{ segment: SegmentRecord }> {
    return requestJson(`/api/projects/${projectId}/segments/${segId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  synthesizeSegment(projectId: string, segId: string): Promise<{ segment: SegmentRecord }> {
    return requestJson(`/api/projects/${projectId}/segments/${segId}/synthesize`, {
      method: 'POST',
    });
  },

  updateSpeaker(
    projectId: string,
    speakerRowId: string,
    patch: Partial<SpeakerRecord>
  ): Promise<{ speaker: SpeakerRecord; segments: SegmentRecord[] }> {
    return requestJson(`/api/projects/${projectId}/speakers/${speakerRowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  listExports(): Promise<{ jobs: BatchExportJob[] }> {
    return requestJson('/api/exports');
  },

  createExport(payload: {
    projectId: string;
    resolution: '720p' | '1080p' | '4k' | 'original';
    codec: 'h264' | 'h265';
    exportSrt: boolean;
  }): Promise<{ job: BatchExportJob }> {
    return requestJson('/api/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
};
