import { Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { executeWithGeminiRotation, executeWithGroqRotation, getProviderPoolStatus, isRateLimitError } from './keyRotation.ts';
import type { EmotionType, GeminiModelOption, SegmentRecord, SpeakerRecord } from './types.ts';
import { SUPPORTED_EMOTIONS } from './types.ts';

export interface TranscribedCue {
  startTime: number;
  endTime: number;
  text: string;
  speakerHint?: string;
  detectedLanguage?: string;
}

export async function transcribeChunkWithGroq(
  chunkPath: string,
  offsetSec: number,
  sourceLanguage: string
): Promise<{ cues: TranscribedCue[]; detectedLanguage: string }> {
  return executeWithGroqRotation(async (groqKey) => {
    const fileBytes = fs.readFileSync(chunkPath);
    const form = new FormData();
    const blob = new Blob([fileBytes], { type: 'audio/mpeg' });
    form.append('file', blob, path.basename(chunkPath));
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (sourceLanguage && sourceLanguage !== 'auto') {
      form.append('language', sourceLanguage);
    }

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
      },
      body: form,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      const err = new Error(`Groq Whisper HTTP ${resp.status}: ${errBody}`) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }

    const data = (await resp.json()) as {
      language?: string;
      text?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    const segs = data.segments ?? [];
    const cues: TranscribedCue[] = segs
      .map((s) => ({
        startTime: Math.round((offsetSec + Number(s.start)) * 100) / 100,
        endTime: Math.round((offsetSec + Number(s.end)) * 100) / 100,
        text: String(s.text ?? '').trim(),
        detectedLanguage: data.language ?? sourceLanguage,
      }))
      .filter((c) => c.text.length > 0 && c.endTime > c.startTime);

    return {
      cues,
      detectedLanguage: data.language || sourceLanguage || 'unknown',
    };
  });
}

export async function transcribeChunkWithGemini(
  chunkPath: string,
  offsetSec: number,
  sourceLanguage: string
): Promise<{ cues: TranscribedCue[]; detectedLanguage: string }> {
  const base64Audio = fs.readFileSync(chunkPath).toString('base64');
  const langInstruction =
    sourceLanguage && sourceLanguage !== 'auto'
      ? `The expected spoken language is ${sourceLanguage}, though speakers may code-switch.`
      : 'Auto-detect the spoken language(s) accurately.';

  return executeWithGeminiRotation(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Audio,
            },
          },
          {
            text:
              `Listen carefully to this audio clip and transcribe every spoken sentence with exact startSec and endSec timestamps relative to the start of this clip (0.00 seconds). ` +
              `${langInstruction} Separate distinct speakers using speakerHint labels like SPEAKER_01, SPEAKER_02 based on voice timbre changes. ` +
              `Preserve natural sentence boundaries and exact spoken meaning. Do not translate—transcribe in the original spoken language.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  speakerHint: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ['startSec', 'endSec', 'text'],
              },
            },
          },
          required: ['detectedLanguage', 'segments'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      detectedLanguage?: string;
      segments?: Array<{ startSec: number; endSec: number; speakerHint?: string; text: string }>;
    };

    const cues: TranscribedCue[] = (parsed.segments ?? [])
      .map((s) => ({
        startTime: Math.round((offsetSec + Math.max(0, Number(s.startSec))) * 100) / 100,
        endTime: Math.round((offsetSec + Math.max(Number(s.startSec) + 0.3, Number(s.endSec))) * 100) / 100,
        text: String(s.text ?? '').trim(),
        speakerHint: s.speakerHint?.trim() || undefined,
        detectedLanguage: parsed.detectedLanguage || sourceLanguage,
      }))
      .filter((c) => c.text.length > 0);

    return {
      cues,
      detectedLanguage: parsed.detectedLanguage || sourceLanguage || 'unknown',
    };
  });
}

export async function transcribeAudioChunk(
  chunkPath: string,
  offsetSec: number,
  sourceLanguage: string,
  asrEngine: 'auto' | 'groq-whisper' | 'gemini-transcribe'
): Promise<{ cues: TranscribedCue[]; detectedLanguage: string; engineUsed: string }> {
  const pool = getProviderPoolStatus();
  const shouldTryGroq =
    asrEngine === 'groq-whisper' || (asrEngine === 'auto' && pool.groq.hasAnyReady);

  if (shouldTryGroq) {
    try {
      const res = await transcribeChunkWithGroq(chunkPath, offsetSec, sourceLanguage);
      return { ...res, engineUsed: 'Groq Whisper (whisper-large-v3-turbo)' };
    } catch (err) {
      if (asrEngine === 'groq-whisper') {
        throw err;
      }
      // In 'auto' mode, gracefully fall back to Gemini audio transcription if Groq fails/has no key
    }
  }

  const gemRes = await transcribeChunkWithGemini(chunkPath, offsetSec, sourceLanguage);
  return { ...gemRes, engineUsed: 'Gemini Audio Transcription' };
}

export interface DiarizationResult {
  storySummary: string;
  speakers: Array<{
    speakerId: string;
    displayName: string;
    gender: 'male' | 'female' | 'neutral';
    recommendedVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
    defaultEmotion: EmotionType;
  }>;
  segmentAssignments: Array<{
    idx: number;
    speakerId: string;
  }>;
}

export async function diarizeTranscript(
  segments: Array<{ idx: number; startTime: number; endTime: number; sourceText: string; speakerHint?: string }>,
  geminiModel: GeminiModelOption
): Promise<DiarizationResult> {
  const primaryModel = geminiModel === 'gemini-4-neon' ? 'gemini-4-hydrogen' : geminiModel;

  const runWithModel = (modelToUse: string) =>
    executeWithGeminiRotation(async (ai) => {
      const compactTranscript = segments.map((s) => ({
        idx: s.idx,
        t: `${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)}`,
        hint: s.speakerHint ?? null,
        text: s.sourceText,
      }));

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents:
          `Analyze this chronological dialogue transcript from a video. Identify every distinct speaker/character across the whole story, maintain consistent speakerId labels (SPEAKER_01, SPEAKER_02, ...), infer likely gender (male/female/neutral), suggest a fitting character name/role (e.g., "Narrator", "Male Lead", "Young Woman"), and assign one of these Gemini voice names: Puck (agile male), Charon (deep calm male), Fenrir (intense male), Kore (warm female), Zephyr (bright female).\n\nTranscript JSON:\n${JSON.stringify(
            compactTranscript
          )}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            storySummary: { type: Type.STRING },
            speakers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speakerId: { type: Type.STRING },
                  displayName: { type: Type.STRING },
                  gender: { type: Type.STRING },
                  recommendedVoice: { type: Type.STRING },
                  defaultEmotion: { type: Type.STRING },
                },
                required: ['speakerId', 'displayName', 'gender', 'recommendedVoice'],
              },
            },
            segmentAssignments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  idx: { type: Type.INTEGER },
                  speakerId: { type: Type.STRING },
                },
                required: ['idx', 'speakerId'],
              },
            },
          },
          required: ['storySummary', 'speakers', 'segmentAssignments'],
        },
      },
    });

    const raw = JSON.parse((response.text ?? '{}').trim()) as DiarizationResult;
    const validVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
    const validEmotions = new Set<string>(SUPPORTED_EMOTIONS);

    const speakers = (raw.speakers ?? []).map((sp, i) => {
      const gender: 'male' | 'female' | 'neutral' =
        sp.gender === 'male' || sp.gender === 'female' ? sp.gender : 'neutral';
      const fallbackVoice = gender === 'female' ? 'Kore' : 'Puck';
      return {
        speakerId: sp.speakerId || `SPEAKER_${String(i + 1).padStart(2, '0')}`,
        displayName: sp.displayName || `Character ${i + 1}`,
        gender,
        recommendedVoice: (validVoices.has(sp.recommendedVoice) ? sp.recommendedVoice : fallbackVoice) as
          | 'Puck'
          | 'Charon'
          | 'Kore'
          | 'Fenrir'
          | 'Zephyr',
        defaultEmotion: (validEmotions.has(sp.defaultEmotion) ? sp.defaultEmotion : 'Calm') as EmotionType,
      };
    });

    if (speakers.length === 0) {
      speakers.push({
        speakerId: 'SPEAKER_01',
        displayName: 'Speaker 1',
        gender: 'neutral',
        recommendedVoice: 'Kore',
        defaultEmotion: 'Calm',
      });
    }

      return {
        storySummary: raw.storySummary || 'Dialogue scene.',
        speakers,
        segmentAssignments: raw.segmentAssignments ?? [],
      };
    });

  try {
    return await runWithModel(primaryModel);
  } catch (err) {
    if (isRateLimitError(err) && primaryModel !== 'gemini-3.1-flash-lite') {
      return await runWithModel('gemini-3.1-flash-lite');
    }
    throw err;
  }
}

export interface TranslatedLineResult {
  idx: number;
  khmerText: string;
  emotion: EmotionType;
  actingNotes: string;
}

export async function translateBatchToKhmer(opts: {
  segments: SegmentRecord[];
  speakers: SpeakerRecord[];
  storySummary: string;
  previousContext: string;
  geminiModel: GeminiModelOption;
}): Promise<TranslatedLineResult[]> {
  const primaryModel = opts.geminiModel === 'gemini-4-neon' ? 'gemini-4-hydrogen' : opts.geminiModel;
  const speakerLookup = new Map(opts.speakers.map((s) => [s.speakerId, s]));

  const payload = opts.segments.map((s) => {
    const sp = speakerLookup.get(s.speakerId);
    const windowSec = Math.max(0.5, s.endTime - s.startTime);
    return {
      idx: s.idx,
      durationSec: Number(windowSec.toFixed(2)),
      speaker: sp ? `${sp.displayName} (${sp.speakerId}, ${sp.gender})` : s.speakerId,
      sourceText: s.sourceText,
    };
  });

  const runWithModel = (modelToUse: string) =>
    executeWithGeminiRotation(async (ai) => {
      const response = await ai.models.generateContent({
        model: modelToUse,
      contents:
        `You are an expert Khmer film & video dubbing scriptwriter. Translate EVERY segment below into natural, idiomatic, spoken Khmer (ភាសាខ្មែរ) suitable for voice acting.\n` +
        `Rules:\n` +
        `1. Understand the full story context and maintain character names, relationships, and appropriate Khmer pronouns/honorifics (e.g., បង, អូន, លោក, អ្នកនាង, ខ្ញុំ, ឯង).\n` +
        `2. Never translate word-for-word literally; make the Khmer sound like real spoken dialogue in modern Cambodian dubbing.\n` +
        `3. Keep spoken length proportional to durationSec so the voice actor can deliver it naturally without rushing.\n` +
        `4. Never omit or merge any idx. Every input idx must appear in your output.\n` +
        `5. Classify each line's emotion strictly from this list: ${SUPPORTED_EMOTIONS.join(', ')}.\n` +
        `6. Provide short English actingNotes describing vocal delivery (e.g., "soft trembling whisper", "urgent shout").\n\n` +
        `Story context: ${opts.storySummary}\n` +
        (opts.previousContext ? `Previous lines context:\n${opts.previousContext}\n\n` : '\n') +
        `Segments to translate:\n${JSON.stringify(payload)}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  idx: { type: Type.INTEGER },
                  khmerText: { type: Type.STRING },
                  emotion: { type: Type.STRING },
                  actingNotes: { type: Type.STRING },
                },
                required: ['idx', 'khmerText', 'emotion', 'actingNotes'],
              },
            },
          },
          required: ['translations'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      translations?: Array<{ idx: number; khmerText: string; emotion: string; actingNotes: string }>;
    };

      const validEmotions = new Set<string>(SUPPORTED_EMOTIONS);
      return (parsed.translations ?? []).map((t) => ({
        idx: Number(t.idx),
        khmerText: String(t.khmerText ?? '').trim(),
        emotion: (validEmotions.has(t.emotion) ? t.emotion : 'Calm') as EmotionType,
        actingNotes: String(t.actingNotes ?? '').trim(),
      }));
    });

  try {
    return await runWithModel(primaryModel);
  } catch (err) {
    if (isRateLimitError(err) && primaryModel !== 'gemini-3.1-flash-lite') {
      return await runWithModel('gemini-3.1-flash-lite');
    }
    throw err;
  }
}

const EMOTION_STYLE_MAP: Record<EmotionType, string> = {
  Happy: 'cheerful, warm, smiling upbeat vocal tone',
  Sad: 'melancholic, gentle, downcast sorrowful cadence',
  Angry: 'sharp, tense, forceful angry delivery',
  Excited: 'high-energy, enthusiastic, rapid joyful inflection',
  Romantic: 'soft, affectionate, warm intimate voice',
  Scared: 'trembling, breathless, anxious fearful delivery',
  Serious: 'grounded, solemn, focused authoritative tone',
  Calm: 'steady, relaxed, natural conversational tone',
  Whispering: 'hushed, quiet, airy secretive whisper',
  Crying: 'tearful, quivering, emotionally overwhelmed sobbing tone',
  Shouting: 'loud, urgent, projecting forceful yell',
  Surprised: 'sudden raised pitch, astonished startled reaction',
};

export async function generateKhmerTtsWav(opts: {
  khmerText: string;
  voiceName: string;
  emotion: EmotionType;
  actingNotes?: string;
  personaStyle?: string;
  useExpressiveModel?: boolean;
  outWavPath: string;
}): Promise<void> {
  const emotionStyle = EMOTION_STYLE_MAP[opts.emotion] ?? EMOTION_STYLE_MAP.Calm;
  const combinedStyle = [
    'Speak naturally in Khmer (Cambodian) with authentic pronunciation and clear phrasing.',
    emotionStyle,
    opts.actingNotes ? `Direction: ${opts.actingNotes}` : '',
    opts.personaStyle ? `Voice persona: ${opts.personaStyle}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const primaryModel = opts.useExpressiveModel ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';
  const validVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
  const safeVoice = validVoices.has(opts.voiceName) ? opts.voiceName : 'Kore';

  const synthesizeWithModel = (model: string) =>
    executeWithGeminiRotation(async (ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: opts.khmerText,
                speechMetadata: {
                  style: combinedStyle,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: safeVoice,
              },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('TTS model returned no audio data.');
      }
      return Buffer.from(base64Audio, 'base64');
    });

  let wavBuffer: Buffer;
  try {
    wavBuffer = await synthesizeWithModel(primaryModel);
  } catch (err) {
    if (isRateLimitError(err) && primaryModel === 'gemini-3.8-flash-tts') {
      wavBuffer = await synthesizeWithModel('gemini-3.8-flash-lite-tts');
    } else {
      throw err;
    }
  }

  fs.mkdirSync(path.dirname(opts.outWavPath), { recursive: true });
  fs.writeFileSync(opts.outWavPath, wavBuffer);
}

export async function generateSampleEnglishSpeechWav(
  text: string,
  voiceName: 'Puck' | 'Kore',
  style: string,
  outWavPath: string
): Promise<void> {
  const wavBuffer = await executeWithGeminiRotation(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
              speechMetadata: { style },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error('Failed to synthesize demo speech clip.');
    return Buffer.from(base64Audio, 'base64');
  });
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  fs.writeFileSync(outWavPath, wavBuffer);
}

export async function analyzeVoiceSampleForCloning(samplePath: string): Promise<{
  gender: 'male' | 'female' | 'neutral';
  recommendedBaseVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  stylePrompt: string;
}> {
  const ext = path.extname(samplePath).toLowerCase().replace('.', '');
  const mimeType = ext === 'mp3' ? 'audio/mp3' : ext === 'm4a' ? 'audio/mp4' : 'audio/wav';
  const base64 = fs.readFileSync(samplePath).toString('base64');

  return executeWithGeminiRotation(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
          {
            text:
              'Analyze this authorized speaker voice sample for voice profile creation. Determine gender (male, female, or neutral), select the closest base vocal timbre from [Puck, Charon, Kore, Fenrir, Zephyr], and write a detailed 1-sentence vocal stylePrompt describing pitch register, warmth, cadence, breathiness, and resonance.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            gender: { type: Type.STRING },
            recommendedBaseVoice: { type: Type.STRING },
            stylePrompt: { type: Type.STRING },
          },
          required: ['gender', 'recommendedBaseVoice', 'stylePrompt'],
        },
      },
    });

    const data = JSON.parse((response.text ?? '{}').trim()) as {
      gender?: string;
      recommendedBaseVoice?: string;
      stylePrompt?: string;
    };

    const gender = data.gender === 'male' || data.gender === 'female' ? data.gender : 'neutral';
    const validVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
    const fallback = gender === 'female' ? 'Kore' : 'Charon';

    return {
      gender,
      recommendedBaseVoice: (validVoices.has(data.recommendedBaseVoice ?? '')
        ? data.recommendedBaseVoice
        : fallback) as 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr',
      stylePrompt:
        data.stylePrompt?.trim() ||
        'Natural, expressive cloned vocal timbre with balanced resonance and clear articulation.',
    };
  });
}
