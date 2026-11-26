export type EmotionType =
  | 'Happy'
  | 'Sad'
  | 'Angry'
  | 'Excited'
  | 'Romantic'
  | 'Scared'
  | 'Serious'
  | 'Calm'
  | 'Whispering'
  | 'Crying'
  | 'Shouting'
  | 'Surprised';

export const SUPPORTED_EMOTIONS: EmotionType[] = [
  'Happy',
  'Sad',
  'Angry',
  'Excited',
  'Romantic',
  'Scared',
  'Serious',
  'Calm',
  'Whispering',
  'Crying',
  'Shouting',
  'Surprised',
];

export type GeminiModelOption =
  | 'gemini-4-hydrogen'
  | 'gemini-4-neon'
  | 'gemini-3.1-flash-lite';

export type AsrEngineOption = 'auto' | 'groq-whisper' | 'gemini-transcribe';

export type ProjectStatus =
  | 'imported'
  | 'analyzing'
  | 'transcribed'
  | 'diarized'
  | 'translated'
  | 'dubbed'
  | 'mixed'
  | 'exported'
  | 'error';

export interface ProjectRecord {
  id: string;
  name: string;
  originalFilename: string;
  videoPath: string;
  audioWavPath: string | null;
  previewVideoPath: string | null;
  mixedAudioPath: string | null;
  exportedMp4Path: string | null;
  exportedSrtPath: string | null;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasEmbeddedSubtitles: boolean;
  sourceLanguage: string;
  targetGeminiModel: GeminiModelOption;
  asrEngine: AsrEngineOption;
  status: ProjectStatus;
  progressPct: number;
  currentStep: string;
  errorMessage: string | null;
  bgmVolume: number;
  dubVolume: number;
  voiceReductionMode: 'soft' | 'aggressive' | 'off';
  outputResolution: '720p' | '1080p' | '4k' | 'original';
  videoCodec: 'h264' | 'h265';
  outputFolder: string;
  storySummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentRecord {
  id: string;
  projectId: string;
  idx: number;
  startTime: number;
  endTime: number;
  speakerId: string;
  sourceText: string;
  khmerText: string;
  emotion: EmotionType;
  actingNotes: string;
  speechSpeed: number;
  pitchShift: number;
  voiceName: string;
  ttsAudioPath: string | null;
  ttsDurationSec: number;
  status: 'pending' | 'translated' | 'synthesized' | 'error';
}

export interface SpeakerRecord {
  id: string;
  projectId: string;
  speakerId: string;
  displayName: string;
  gender: 'male' | 'female' | 'neutral';
  assignedVoice: string;
  clonedVoiceId: string | null;
  defaultEmotion: EmotionType;
  pitchOffset: number;
  speedScale: number;
  lineCount: number;
}

export interface VoiceProfileRecord {
  id: string;
  name: string;
  description: string;
  gender: 'male' | 'female' | 'neutral';
  baseVoice: string;
  samplePath: string | null;
  sampleDurationSec: number;
  isCloned: boolean;
  consentConfirmed: boolean;
  stylePrompt: string;
  pitchDefault: number;
  speedDefault: number;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  provider: 'gemini' | 'groq';
  label: string;
  keyHint: string;
  isEnabled: boolean;
  status: 'active' | 'rate_limited' | 'invalid' | 'disabled';
  usageCount: number;
  errorCount: number;
  lastError: string | null;
  cooldownUntil: number | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface BatchExportJob {
  id: string;
  projectId: string;
  projectName: string;
  resolution: '720p' | '1080p' | '4k' | 'original';
  codec: 'h264' | 'h265';
  exportSrt: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progressPct: number;
  etaSeconds: number | null;
  outputPath: string | null;
  srtPath: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AppSettings {
  defaultOutputFolder: string;
  defaultGeminiModel: GeminiModelOption;
  defaultAsrEngine: AsrEngineOption;
  chunkDurationSec: number;
  autoRetryCount: number;
  autoDuckingEnabled: boolean;
  autoSpeedFitEnabled: boolean;
  maxSpeedFitRatio: number;
  defaultBgmVolume: number;
  defaultDubVolume: number;
  defaultEmotionIntensity: number;
}
