import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ApiKeyRecord,
  AppSettings,
  BatchExportJob,
  EmotionType,
  ProjectRecord,
  SegmentRecord,
  SpeakerRecord,
  VoiceProfileRecord,
} from './types.ts';
import { decryptSecret, encryptSecret, maskApiKey } from './crypto.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'khmer_dubber_pro.sqlite');
const DEFAULT_EXPORT_DIR = path.resolve(process.cwd(), 'exports');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DEFAULT_EXPORT_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    originalFilename TEXT NOT NULL,
    videoPath TEXT NOT NULL,
    audioWavPath TEXT,
    previewVideoPath TEXT,
    mixedAudioPath TEXT,
    exportedMp4Path TEXT,
    exportedSrtPath TEXT,
    durationSec REAL NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 1920,
    height INTEGER NOT NULL DEFAULT 1080,
    fps REAL NOT NULL DEFAULT 30,
    hasEmbeddedSubtitles INTEGER NOT NULL DEFAULT 0,
    sourceLanguage TEXT NOT NULL DEFAULT 'auto',
    targetGeminiModel TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
    asrEngine TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'imported',
    progressPct INTEGER NOT NULL DEFAULT 0,
    currentStep TEXT NOT NULL DEFAULT 'Ready for auto dubbing',
    errorMessage TEXT,
    bgmVolume REAL NOT NULL DEFAULT 0.35,
    dubVolume REAL NOT NULL DEFAULT 1.0,
    voiceReductionMode TEXT NOT NULL DEFAULT 'soft',
    outputResolution TEXT NOT NULL DEFAULT '1080p',
    videoCodec TEXT NOT NULL DEFAULT 'h264',
    outputFolder TEXT NOT NULL,
    storySummary TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    idx INTEGER NOT NULL,
    startTime REAL NOT NULL,
    endTime REAL NOT NULL,
    speakerId TEXT NOT NULL,
    sourceText TEXT NOT NULL,
    khmerText TEXT NOT NULL DEFAULT '',
    emotion TEXT NOT NULL DEFAULT 'Calm',
    actingNotes TEXT NOT NULL DEFAULT '',
    speechSpeed REAL NOT NULL DEFAULT 1.0,
    pitchShift REAL NOT NULL DEFAULT 0,
    voiceName TEXT NOT NULL DEFAULT 'Kore',
    ttsAudioPath TEXT,
    ttsDurationSec REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS speakers (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    speakerId TEXT NOT NULL,
    displayName TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'neutral',
    assignedVoice TEXT NOT NULL DEFAULT 'Kore',
    clonedVoiceId TEXT,
    defaultEmotion TEXT NOT NULL DEFAULT 'Calm',
    pitchOffset REAL NOT NULL DEFAULT 0,
    speedScale REAL NOT NULL DEFAULT 1.0,
    lineCount INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'neutral',
    baseVoice TEXT NOT NULL DEFAULT 'Kore',
    samplePath TEXT,
    sampleDurationSec REAL NOT NULL DEFAULT 0,
    isCloned INTEGER NOT NULL DEFAULT 0,
    consentConfirmed INTEGER NOT NULL DEFAULT 1,
    stylePrompt TEXT NOT NULL DEFAULT '',
    pitchDefault REAL NOT NULL DEFAULT 0,
    speedDefault REAL NOT NULL DEFAULT 1.0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    label TEXT NOT NULL,
    encryptedKey TEXT NOT NULL,
    keyHint TEXT NOT NULL,
    isEnabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    usageCount INTEGER NOT NULL DEFAULT 0,
    errorCount INTEGER NOT NULL DEFAULT 0,
    lastError TEXT,
    cooldownUntil INTEGER,
    lastUsedAt TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    projectName TEXT NOT NULL,
    resolution TEXT NOT NULL,
    codec TEXT NOT NULL,
    exportSrt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued',
    progressPct INTEGER NOT NULL DEFAULT 0,
    etaSeconds INTEGER,
    outputPath TEXT,
    srtPath TEXT,
    errorMessage TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS: AppSettings = {
  defaultOutputFolder: DEFAULT_EXPORT_DIR,
  defaultGeminiModel: 'gemini-4-hydrogen',
  defaultAsrEngine: 'auto',
  chunkDurationSec: 90,
  autoRetryCount: 3,
  autoDuckingEnabled: true,
  autoSpeedFitEnabled: true,
  maxSpeedFitRatio: 1.32,
  defaultBgmVolume: 0.35,
  defaultDubVolume: 1.0,
  defaultEmotionIntensity: 0.85,
};

function seedDefaults(): void {
  const voiceCountRow = db.prepare('SELECT COUNT(*) as cnt FROM voice_profiles').get() as { cnt: number };
  if (!voiceCountRow || voiceCountRow.cnt === 0) {
    const now = new Date().toISOString();
    const presets = [
      {
        id: 'voice-kore-kh',
        name: 'Sophea (Female Lead)',
        description: 'Warm, expressive Khmer female voice suitable for drama leads and storytelling.',
        gender: 'female',
        baseVoice: 'Kore',
        stylePrompt: 'Warm, natural Cambodian female film voice actress, expressive emotional phrasing, clear Khmer syllable articulation.',
        pitchDefault: 0,
        speedDefault: 1.0,
      },
      {
        id: 'voice-zephyr-kh',
        name: 'Bopha (Bright Female)',
        description: 'Youthful, bright female timbre suited for romance, comedy, and upbeat narration.',
        gender: 'female',
        baseVoice: 'Zephyr',
        stylePrompt: 'Bright, agile young female voice actress, expressive intonation and gentle conversational rhythm.',
        pitchDefault: 1,
        speedDefault: 1.02,
      },
      {
        id: 'voice-charon-kh',
        name: 'Vannak (Deep Male)',
        description: 'Authoritative, grounded male baritone for action leads, mentors, and documentaries.',
        gender: 'male',
        baseVoice: 'Charon',
        stylePrompt: 'Deep, calm, authoritative Cambodian male voice actor, steady dramatic gravitas and crisp consonant clarity.',
        pitchDefault: -1,
        speedDefault: 0.98,
      },
      {
        id: 'voice-puck-kh',
        name: 'Dara (Dynamic Male)',
        description: 'Energetic, agile male voice suited for protagonists, dialogue banter, and thrillers.',
        gender: 'male',
        baseVoice: 'Puck',
        stylePrompt: 'Dynamic, expressive male lead voice actor with natural conversational pacing and emotional range.',
        pitchDefault: 0,
        speedDefault: 1.0,
      },
      {
        id: 'voice-fenrir-kh',
        name: 'Rithy (Intense Male)',
        description: 'Strong, resonant male voice ideal for antagonists, intense drama, and trailers.',
        gender: 'male',
        baseVoice: 'Fenrir',
        stylePrompt: 'Rich, intense dramatic male voice with strong projection for serious, angry, or high-stakes scenes.',
        pitchDefault: -2,
        speedDefault: 0.97,
      },
    ];
    const insert = db.prepare(`
      INSERT INTO voice_profiles (id, name, description, gender, baseVoice, samplePath, sampleDurationSec, isCloned, consentConfirmed, stylePrompt, pitchDefault, speedDefault, createdAt)
      VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 1, ?, ?, ?, ?)
    `);
    for (const p of presets) {
      insert.run(p.id, p.name, p.description, p.gender, p.baseVoice, p.stylePrompt, p.pitchDefault, p.speedDefault, now);
    }
  }

  const upsertSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    upsertSetting.run(k, JSON.stringify(v));
  }
}

seedDefaults();

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    originalFilename: String(row.originalFilename),
    videoPath: String(row.videoPath),
    audioWavPath: row.audioWavPath ? String(row.audioWavPath) : null,
    previewVideoPath: row.previewVideoPath ? String(row.previewVideoPath) : null,
    mixedAudioPath: row.mixedAudioPath ? String(row.mixedAudioPath) : null,
    exportedMp4Path: row.exportedMp4Path ? String(row.exportedMp4Path) : null,
    exportedSrtPath: row.exportedSrtPath ? String(row.exportedSrtPath) : null,
    durationSec: Number(row.durationSec ?? 0),
    width: Number(row.width ?? 1920),
    height: Number(row.height ?? 1080),
    fps: Number(row.fps ?? 30),
    hasEmbeddedSubtitles: Boolean(row.hasEmbeddedSubtitles),
    sourceLanguage: String(row.sourceLanguage ?? 'auto'),
    targetGeminiModel: String(row.targetGeminiModel ?? 'gemini-4-hydrogen') as ProjectRecord['targetGeminiModel'],
    asrEngine: String(row.asrEngine ?? 'auto') as ProjectRecord['asrEngine'],
    status: String(row.status ?? 'imported') as ProjectRecord['status'],
    progressPct: Number(row.progressPct ?? 0),
    currentStep: String(row.currentStep ?? ''),
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    bgmVolume: Number(row.bgmVolume ?? 0.35),
    dubVolume: Number(row.dubVolume ?? 1.0),
    voiceReductionMode: String(row.voiceReductionMode ?? 'soft') as ProjectRecord['voiceReductionMode'],
    outputResolution: String(row.outputResolution ?? '1080p') as ProjectRecord['outputResolution'],
    videoCodec: String(row.videoCodec ?? 'h264') as ProjectRecord['videoCodec'],
    outputFolder: String(row.outputFolder ?? DEFAULT_EXPORT_DIR),
    storySummary: row.storySummary ? String(row.storySummary) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapSegment(row: Record<string, unknown>): SegmentRecord {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    idx: Number(row.idx),
    startTime: Number(row.startTime),
    endTime: Number(row.endTime),
    speakerId: String(row.speakerId),
    sourceText: String(row.sourceText),
    khmerText: String(row.khmerText ?? ''),
    emotion: String(row.emotion ?? 'Calm') as EmotionType,
    actingNotes: String(row.actingNotes ?? ''),
    speechSpeed: Number(row.speechSpeed ?? 1.0),
    pitchShift: Number(row.pitchShift ?? 0),
    voiceName: String(row.voiceName ?? 'Kore'),
    ttsAudioPath: row.ttsAudioPath ? String(row.ttsAudioPath) : null,
    ttsDurationSec: Number(row.ttsDurationSec ?? 0),
    status: String(row.status ?? 'pending') as SegmentRecord['status'],
  };
}

function mapSpeaker(row: Record<string, unknown>): SpeakerRecord {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    speakerId: String(row.speakerId),
    displayName: String(row.displayName),
    gender: String(row.gender ?? 'neutral') as SpeakerRecord['gender'],
    assignedVoice: String(row.assignedVoice ?? 'Kore'),
    clonedVoiceId: row.clonedVoiceId ? String(row.clonedVoiceId) : null,
    defaultEmotion: String(row.defaultEmotion ?? 'Calm') as EmotionType,
    pitchOffset: Number(row.pitchOffset ?? 0),
    speedScale: Number(row.speedScale ?? 1.0),
    lineCount: Number(row.lineCount ?? 0),
  };
}

function mapVoiceProfile(row: Record<string, unknown>): VoiceProfileRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    gender: String(row.gender ?? 'neutral') as VoiceProfileRecord['gender'],
    baseVoice: String(row.baseVoice ?? 'Kore'),
    samplePath: row.samplePath ? String(row.samplePath) : null,
    sampleDurationSec: Number(row.sampleDurationSec ?? 0),
    isCloned: Boolean(row.isCloned),
    consentConfirmed: Boolean(row.consentConfirmed),
    stylePrompt: String(row.stylePrompt ?? ''),
    pitchDefault: Number(row.pitchDefault ?? 0),
    speedDefault: Number(row.speedDefault ?? 1.0),
    createdAt: String(row.createdAt),
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    provider: String(row.provider) as 'gemini' | 'groq',
    label: String(row.label),
    keyHint: String(row.keyHint),
    isEnabled: Boolean(row.isEnabled),
    status: String(row.status) as ApiKeyRecord['status'],
    usageCount: Number(row.usageCount ?? 0),
    errorCount: Number(row.errorCount ?? 0),
    lastError: row.lastError ? String(row.lastError) : null,
    cooldownUntil: row.cooldownUntil !== null && row.cooldownUntil !== undefined ? Number(row.cooldownUntil) : null,
    lastUsedAt: row.lastUsedAt ? String(row.lastUsedAt) : null,
    createdAt: String(row.createdAt),
  };
}

function mapExportJob(row: Record<string, unknown>): BatchExportJob {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    projectName: String(row.projectName),
    resolution: String(row.resolution) as BatchExportJob['resolution'],
    codec: String(row.codec) as BatchExportJob['codec'],
    exportSrt: Boolean(row.exportSrt),
    status: String(row.status) as BatchExportJob['status'],
    progressPct: Number(row.progressPct ?? 0),
    etaSeconds: row.etaSeconds !== null && row.etaSeconds !== undefined ? Number(row.etaSeconds) : null,
    outputPath: row.outputPath ? String(row.outputPath) : null,
    srtPath: row.srtPath ? String(row.srtPath) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    createdAt: String(row.createdAt),
  };
}

export const store = {
  getSettings(): AppSettings {
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      try {
        merged[String(r.key)] = JSON.parse(String(r.value));
      } catch {
        merged[String(r.key)] = r.value;
      }
    }
    return merged as unknown as AppSettings;
  },

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const upsert = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(partial)) {
      if (v !== undefined) {
        upsert.run(k, JSON.stringify(v));
      }
    }
    return this.getSettings();
  },

  listProjects(): ProjectRecord[] {
    const rows = db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC').all();
    return rows.map(mapProject);
  },

  getProject(id: string): ProjectRecord | null {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? mapProject(row) : null;
  },

  createProject(input: Omit<ProjectRecord, 'createdAt' | 'updatedAt'>): ProjectRecord {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (
        id, name, originalFilename, videoPath, audioWavPath, previewVideoPath, mixedAudioPath,
        exportedMp4Path, exportedSrtPath, durationSec, width, height, fps, hasEmbeddedSubtitles,
        sourceLanguage, targetGeminiModel, asrEngine, status, progressPct, currentStep, errorMessage,
        bgmVolume, dubVolume, voiceReductionMode, outputResolution, videoCodec, outputFolder,
        storySummary, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.name,
      input.originalFilename,
      input.videoPath,
      input.audioWavPath,
      input.previewVideoPath,
      input.mixedAudioPath,
      input.exportedMp4Path,
      input.exportedSrtPath,
      input.durationSec,
      input.width,
      input.height,
      input.fps,
      input.hasEmbeddedSubtitles ? 1 : 0,
      input.sourceLanguage,
      input.targetGeminiModel,
      input.asrEngine,
      input.status,
      input.progressPct,
      input.currentStep,
      input.errorMessage,
      input.bgmVolume,
      input.dubVolume,
      input.voiceReductionMode,
      input.outputResolution,
      input.videoCodec,
      input.outputFolder,
      input.storySummary,
      now,
      now
    );
    return this.getProject(input.id)!;
  },

  updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord | null {
    const existing = this.getProject(id);
    if (!existing) return null;
    const merged: ProjectRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    db.prepare(`
      UPDATE projects SET
        name = ?, originalFilename = ?, videoPath = ?, audioWavPath = ?, previewVideoPath = ?,
        mixedAudioPath = ?, exportedMp4Path = ?, exportedSrtPath = ?, durationSec = ?,
        width = ?, height = ?, fps = ?, hasEmbeddedSubtitles = ?, sourceLanguage = ?,
        targetGeminiModel = ?, asrEngine = ?, status = ?, progressPct = ?, currentStep = ?,
        errorMessage = ?, bgmVolume = ?, dubVolume = ?, voiceReductionMode = ?,
        outputResolution = ?, videoCodec = ?, outputFolder = ?, storySummary = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.originalFilename,
      merged.videoPath,
      merged.audioWavPath,
      merged.previewVideoPath,
      merged.mixedAudioPath,
      merged.exportedMp4Path,
      merged.exportedSrtPath,
      merged.durationSec,
      merged.width,
      merged.height,
      merged.fps,
      merged.hasEmbeddedSubtitles ? 1 : 0,
      merged.sourceLanguage,
      merged.targetGeminiModel,
      merged.asrEngine,
      merged.status,
      merged.progressPct,
      merged.currentStep,
      merged.errorMessage,
      merged.bgmVolume,
      merged.dubVolume,
      merged.voiceReductionMode,
      merged.outputResolution,
      merged.videoCodec,
      merged.outputFolder,
      merged.storySummary,
      merged.updatedAt,
      id
    );
    return this.getProject(id);
  },

  deleteProject(id: string): boolean {
    const res = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return res.changes > 0;
  },

  listSegments(projectId: string): SegmentRecord[] {
    const rows = db.prepare('SELECT * FROM segments WHERE projectId = ? ORDER BY idx ASC').all(projectId);
    return rows.map(mapSegment);
  },

  replaceSegments(projectId: string, segments: SegmentRecord[]): SegmentRecord[] {
    db.prepare('DELETE FROM segments WHERE projectId = ?').run(projectId);
    const ins = db.prepare(`
      INSERT INTO segments (
        id, projectId, idx, startTime, endTime, speakerId, sourceText, khmerText,
        emotion, actingNotes, speechSpeed, pitchShift, voiceName, ttsAudioPath,
        ttsDurationSec, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of segments) {
      ins.run(
        s.id,
        projectId,
        s.idx,
        s.startTime,
        s.endTime,
        s.speakerId,
        s.sourceText,
        s.khmerText,
        s.emotion,
        s.actingNotes,
        s.speechSpeed,
        s.pitchShift,
        s.voiceName,
        s.ttsAudioPath,
        s.ttsDurationSec,
        s.status
      );
    }
    return this.listSegments(projectId);
  },

  updateSegment(segmentId: string, patch: Partial<SegmentRecord>): SegmentRecord | null {
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
    if (!row) return null;
    const existing = mapSegment(row);
    const merged: SegmentRecord = { ...existing, ...patch };
    db.prepare(`
      UPDATE segments SET
        startTime = ?, endTime = ?, speakerId = ?, sourceText = ?, khmerText = ?,
        emotion = ?, actingNotes = ?, speechSpeed = ?, pitchShift = ?, voiceName = ?,
        ttsAudioPath = ?, ttsDurationSec = ?, status = ?
      WHERE id = ?
    `).run(
      merged.startTime,
      merged.endTime,
      merged.speakerId,
      merged.sourceText,
      merged.khmerText,
      merged.emotion,
      merged.actingNotes,
      merged.speechSpeed,
      merged.pitchShift,
      merged.voiceName,
      merged.ttsAudioPath,
      merged.ttsDurationSec,
      merged.status,
      segmentId
    );
    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
    return updated ? mapSegment(updated) : null;
  },

  getSegment(segmentId: string): SegmentRecord | null {
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
    return row ? mapSegment(row) : null;
  },

  listSpeakers(projectId: string): SpeakerRecord[] {
    const rows = db.prepare('SELECT * FROM speakers WHERE projectId = ? ORDER BY speakerId ASC').all(projectId);
    return rows.map(mapSpeaker);
  },

  replaceSpeakers(projectId: string, speakers: SpeakerRecord[]): SpeakerRecord[] {
    db.prepare('DELETE FROM speakers WHERE projectId = ?').run(projectId);
    const ins = db.prepare(`
      INSERT INTO speakers (
        id, projectId, speakerId, displayName, gender, assignedVoice, clonedVoiceId,
        defaultEmotion, pitchOffset, speedScale, lineCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const sp of speakers) {
      ins.run(
        sp.id,
        projectId,
        sp.speakerId,
        sp.displayName,
        sp.gender,
        sp.assignedVoice,
        sp.clonedVoiceId,
        sp.defaultEmotion,
        sp.pitchOffset,
        sp.speedScale,
        sp.lineCount
      );
    }
    return this.listSpeakers(projectId);
  },

  updateSpeaker(id: string, patch: Partial<SpeakerRecord>): SpeakerRecord | null {
    const row = db.prepare('SELECT * FROM speakers WHERE id = ?').get(id);
    if (!row) return null;
    const existing = mapSpeaker(row);
    const merged: SpeakerRecord = { ...existing, ...patch };
    db.prepare(`
      UPDATE speakers SET
        displayName = ?, gender = ?, assignedVoice = ?, clonedVoiceId = ?,
        defaultEmotion = ?, pitchOffset = ?, speedScale = ?, lineCount = ?
      WHERE id = ?
    `).run(
      merged.displayName,
      merged.gender,
      merged.assignedVoice,
      merged.clonedVoiceId,
      merged.defaultEmotion,
      merged.pitchOffset,
      merged.speedScale,
      merged.lineCount,
      id
    );
    const updated = db.prepare('SELECT * FROM speakers WHERE id = ?').get(id);
    return updated ? mapSpeaker(updated) : null;
  },

  listVoiceProfiles(): VoiceProfileRecord[] {
    const rows = db.prepare('SELECT * FROM voice_profiles ORDER BY isCloned DESC, createdAt ASC').all();
    return rows.map(mapVoiceProfile);
  },

  getVoiceProfile(id: string): VoiceProfileRecord | null {
    const row = db.prepare('SELECT * FROM voice_profiles WHERE id = ?').get(id);
    return row ? mapVoiceProfile(row) : null;
  },

  createVoiceProfile(input: Omit<VoiceProfileRecord, 'id' | 'createdAt'>): VoiceProfileRecord {
    const id = `voice-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO voice_profiles (
        id, name, description, gender, baseVoice, samplePath, sampleDurationSec,
        isCloned, consentConfirmed, stylePrompt, pitchDefault, speedDefault, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description,
      input.gender,
      input.baseVoice,
      input.samplePath,
      input.sampleDurationSec,
      input.isCloned ? 1 : 0,
      input.consentConfirmed ? 1 : 0,
      input.stylePrompt,
      input.pitchDefault,
      input.speedDefault,
      now
    );
    return this.getVoiceProfile(id)!;
  },

  deleteVoiceProfile(id: string): boolean {
    const row = this.getVoiceProfile(id);
    if (!row || !row.isCloned) return false;
    if (row.samplePath && fs.existsSync(row.samplePath)) {
      try {
        fs.unlinkSync(row.samplePath);
      } catch {
        // ignore cleanup error
      }
    }
    const res = db.prepare('DELETE FROM voice_profiles WHERE id = ?').run(id);
    return res.changes > 0;
  },

  listApiKeys(provider?: 'gemini' | 'groq'): ApiKeyRecord[] {
    const rows = provider
      ? db.prepare('SELECT * FROM api_keys WHERE provider = ? ORDER BY createdAt ASC').all(provider)
      : db.prepare('SELECT * FROM api_keys ORDER BY provider ASC, createdAt ASC').all();
    return rows.map(mapApiKey);
  },

  addApiKey(provider: 'gemini' | 'groq', label: string, rawKey: string): ApiKeyRecord {
    const id = `key-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const encryptedKey = encryptSecret(rawKey.trim());
    const keyHint = maskApiKey(rawKey);
    db.prepare(`
      INSERT INTO api_keys (
        id, provider, label, encryptedKey, keyHint, isEnabled, status, usageCount, errorCount,
        lastError, cooldownUntil, lastUsedAt, createdAt
      ) VALUES (?, ?, ?, ?, ?, 1, 'active', 0, 0, NULL, NULL, NULL, ?)
    `).run(id, provider, label.trim() || `${provider.toUpperCase()} Key`, encryptedKey, keyHint, now);
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id)!;
    return mapApiKey(row);
  },

  updateApiKey(
    id: string,
    patch: { label?: string; rawKey?: string; isEnabled?: boolean; status?: ApiKeyRecord['status'] }
  ): ApiKeyRecord | null {
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    if (!row) return null;
    const existing = mapApiKey(row);
    let encryptedKey = String(row.encryptedKey);
    let keyHint = existing.keyHint;
    if (patch.rawKey && patch.rawKey.trim().length > 0) {
      encryptedKey = encryptSecret(patch.rawKey.trim());
      keyHint = maskApiKey(patch.rawKey);
    }
    const isEnabled = patch.isEnabled !== undefined ? patch.isEnabled : existing.isEnabled;
    const status =
      patch.status !== undefined
        ? patch.status
        : isEnabled
          ? existing.status === 'disabled'
            ? 'active'
            : existing.status
          : 'disabled';
    db.prepare(`
      UPDATE api_keys SET
        label = ?, encryptedKey = ?, keyHint = ?, isEnabled = ?, status = ?,
        lastError = CASE WHEN ? = 'active' THEN NULL ELSE lastError END,
        cooldownUntil = CASE WHEN ? = 'active' THEN NULL ELSE cooldownUntil END
      WHERE id = ?
    `).run(
      patch.label !== undefined ? patch.label.trim() : existing.label,
      encryptedKey,
      keyHint,
      isEnabled ? 1 : 0,
      status,
      status,
      status,
      id
    );
    const updated = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    return updated ? mapApiKey(updated) : null;
  },

  deleteApiKey(id: string): boolean {
    const res = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return res.changes > 0;
  },

  getRawDecryptedKey(id: string): string | null {
    const row = db.prepare('SELECT encryptedKey FROM api_keys WHERE id = ?').get(id);
    if (!row) return null;
    try {
      return decryptSecret(String(row.encryptedKey));
    } catch {
      return null;
    }
  },

  recordKeyUsage(id: string): void {
    db.prepare(`
      UPDATE api_keys SET
        usageCount = usageCount + 1,
        status = 'active',
        lastError = NULL,
        cooldownUntil = NULL,
        lastUsedAt = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
  },

  recordKeyError(
    id: string,
    status: 'rate_limited' | 'invalid',
    message: string,
    cooldownUntil: number | null
  ): void {
    db.prepare(`
      UPDATE api_keys SET
        errorCount = errorCount + 1,
        status = ?,
        lastError = ?,
        cooldownUntil = ?
      WHERE id = ?
    `).run(status, message.slice(0, 300), cooldownUntil, id);
  },

  listExportJobs(): BatchExportJob[] {
    const rows = db.prepare('SELECT * FROM export_jobs ORDER BY createdAt DESC').all();
    return rows.map(mapExportJob);
  },

  createExportJob(input: Omit<BatchExportJob, 'createdAt'>): BatchExportJob {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO export_jobs (
        id, projectId, projectName, resolution, codec, exportSrt, status, progressPct,
        etaSeconds, outputPath, srtPath, errorMessage, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.projectId,
      input.projectName,
      input.resolution,
      input.codec,
      input.exportSrt ? 1 : 0,
      input.status,
      input.progressPct,
      input.etaSeconds,
      input.outputPath,
      input.srtPath,
      input.errorMessage,
      now
    );
    const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(input.id)!;
    return mapExportJob(row);
  },

  updateExportJob(id: string, patch: Partial<BatchExportJob>): BatchExportJob | null {
    const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
    if (!row) return null;
    const existing = mapExportJob(row);
    const merged: BatchExportJob = { ...existing, ...patch };
    db.prepare(`
      UPDATE export_jobs SET
        status = ?, progressPct = ?, etaSeconds = ?, outputPath = ?, srtPath = ?, errorMessage = ?
      WHERE id = ?
    `).run(
      merged.status,
      merged.progressPct,
      merged.etaSeconds,
      merged.outputPath,
      merged.srtPath,
      merged.errorMessage,
      id
    );
    const updated = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
    return updated ? mapExportJob(updated) : null;
  },
};
