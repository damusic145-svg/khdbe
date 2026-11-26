import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  diarizeTranscript,
  generateKhmerTtsWav,
  transcribeAudioChunk,
  translateBatchToKhmer,
} from './ai.ts';
import { store } from './db.ts';
import {
  adjustAudioSegment,
  exportFinalMp4,
  extractAudioWav,
  extractEmbeddedSubtitles,
  mixAudioAndCreatePreview,
  probeMedia,
  splitAudioChunks,
  writeKhmerSrt,
} from './ffmpeg.ts';
import { getRecommendedPacingMs, withRetryObserver } from './keyRotation.ts';
import type { ProjectRecord, SegmentRecord, SpeakerRecord } from './types.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runWithProjectRetryObserver<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  return withRetryObserver((info) => {
    const secs = Math.max(1, Math.ceil(info.waitMs / 1000));
    store.updateProject(projectId, {
      currentStep: `${info.reason} — waiting ${secs}s (attempt ${info.attempt}/${info.maxAttempts})...`,
    });
  }, fn);
}

const WORKSPACE_DIR = path.resolve(process.cwd(), '.data', 'projects');
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

export function getProjectWorkDir(projectId: string): string {
  const dir = path.join(WORKSPACE_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function runAsrStage(projectId: string): Promise<ProjectRecord> {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const settings = store.getSettings();
  const workDir = getProjectWorkDir(projectId);

  store.updateProject(projectId, {
    status: 'analyzing',
    progressPct: 8,
    currentStep: 'Probing video streams & checking embedded subtitles...',
    errorMessage: null,
  });

  const probe = await probeMedia(project.videoPath);
  const embeddedSrtPath = path.join(workDir, 'embedded.srt');
  const embeddedCues = probe.hasEmbeddedSubtitles
    ? await extractEmbeddedSubtitles(project.videoPath, embeddedSrtPath)
    : [];

  let detectedLang = project.sourceLanguage;
  let segments: SegmentRecord[] = [];

  if (embeddedCues.length > 0) {
    store.updateProject(projectId, {
      progressPct: 24,
      currentStep: `Extracted ${embeddedCues.length} embedded subtitle lines from container.`,
    });
    segments = embeddedCues.map((cue, idx) => ({
      id: `seg-${crypto.randomUUID().slice(0, 8)}`,
      projectId,
      idx,
      startTime: cue.startTime,
      endTime: cue.endTime,
      speakerId: 'SPEAKER_01',
      sourceText: cue.text,
      khmerText: '',
      emotion: 'Calm',
      actingNotes: '',
      speechSpeed: 1.0,
      pitchShift: 0,
      voiceName: 'Kore',
      ttsAudioPath: null,
      ttsDurationSec: 0,
      status: 'pending',
    }));
  } else {
    if (!probe.hasAudio) {
      throw new Error('This video has neither an audio stream nor embedded subtitles to dub.');
    }

    const audioWavPath = path.join(workDir, 'source_16k.wav');
    store.updateProject(projectId, {
      progressPct: 14,
      currentStep: 'Extracting 16kHz audio track via FFmpeg...',
    });
    await extractAudioWav(project.videoPath, audioWavPath);

    const chunkDir = path.join(workDir, 'chunks');
    const chunks = await splitAudioChunks(
      audioWavPath,
      chunkDir,
      settings.chunkDurationSec,
      probe.durationSec
    );

    const allCues: Array<{
      startTime: number;
      endTime: number;
      text: string;
      speakerHint?: string;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        const provider = project.asrEngine === 'groq-whisper' ? 'groq' : 'gemini';
        await sleep(getRecommendedPacingMs(provider));
      }
      const ch = chunks[i];
      const pct = 18 + Math.round(((i + 1) / chunks.length) * 18);
      store.updateProject(projectId, {
        progressPct: pct,
        currentStep: `Transcribing audio chunk ${i + 1}/${chunks.length} (${project.asrEngine})...`,
      });
      const res = await runWithProjectRetryObserver(projectId, () =>
        transcribeAudioChunk(
          ch.path,
          ch.offsetSec,
          project.sourceLanguage,
          project.asrEngine
        )
      );
      if (res.detectedLanguage && res.detectedLanguage !== 'unknown') {
        detectedLang = res.detectedLanguage;
      }
      allCues.push(...res.cues);
    }

    segments = allCues.map((cue, idx) => ({
      id: `seg-${crypto.randomUUID().slice(0, 8)}`,
      projectId,
      idx,
      startTime: cue.startTime,
      endTime: cue.endTime,
      speakerId: cue.speakerHint || 'SPEAKER_01',
      sourceText: cue.text,
      khmerText: '',
      emotion: 'Calm',
      actingNotes: '',
      speechSpeed: 1.0,
      pitchShift: 0,
      voiceName: 'Kore',
      ttsAudioPath: null,
      ttsDurationSec: 0,
      status: 'pending',
    }));

    store.updateProject(projectId, { audioWavPath });
  }

  if (segments.length === 0) {
    throw new Error('No spoken dialogue was detected in this video.');
  }

  store.replaceSegments(projectId, segments);
  return store.updateProject(projectId, {
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasEmbeddedSubtitles: embeddedCues.length > 0,
    sourceLanguage: detectedLang,
    status: 'transcribed',
    progressPct: 36,
    currentStep: `Speech recognition complete (${segments.length} dialogue segments detected).`,
  })!;
}

export async function runDiarizationStage(projectId: string): Promise<ProjectRecord> {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const segments = store.listSegments(projectId);
  if (segments.length === 0) throw new Error('Run speech recognition first before speaker detection.');

  store.updateProject(projectId, {
    progressPct: 42,
    currentStep: 'Detecting distinct characters & voice profiles with Gemini AI...',
    errorMessage: null,
  });

  const diarized = await runWithProjectRetryObserver(projectId, () =>
    diarizeTranscript(
      segments.map((s) => ({
        idx: s.idx,
        startTime: s.startTime,
        endTime: s.endTime,
        sourceText: s.sourceText,
        speakerHint: s.speakerId,
      })),
      project.targetGeminiModel
    )
  );

  const assignmentMap = new Map(diarized.segmentAssignments.map((a) => [a.idx, a.speakerId]));
  const speakerDefMap = new Map(diarized.speakers.map((sp) => [sp.speakerId, sp]));

  const lineCounts = new Map<string, number>();
  const updatedSegments = segments.map((seg) => {
    const spId = assignmentMap.get(seg.idx) ?? seg.speakerId ?? diarized.speakers[0].speakerId;
    const spDef = speakerDefMap.get(spId) ?? diarized.speakers[0];
    lineCounts.set(spDef.speakerId, (lineCounts.get(spDef.speakerId) ?? 0) + 1);
    return {
      ...seg,
      speakerId: spDef.speakerId,
      voiceName: spDef.recommendedVoice,
      emotion: spDef.defaultEmotion,
    };
  });

  const speakersToSave: SpeakerRecord[] = diarized.speakers.map((sp) => ({
    id: `spk-${crypto.randomUUID().slice(0, 8)}`,
    projectId,
    speakerId: sp.speakerId,
    displayName: sp.displayName,
    gender: sp.gender,
    assignedVoice: sp.recommendedVoice,
    clonedVoiceId: null,
    defaultEmotion: sp.defaultEmotion,
    pitchOffset: 0,
    speedScale: 1.0,
    lineCount: lineCounts.get(sp.speakerId) ?? 0,
  }));

  store.replaceSpeakers(projectId, speakersToSave);
  store.replaceSegments(projectId, updatedSegments);

  return store.updateProject(projectId, {
    storySummary: diarized.storySummary,
    status: 'diarized',
    progressPct: 50,
    currentStep: `Identified ${speakersToSave.length} speaker(s) across ${updatedSegments.length} lines.`,
  })!;
}

export async function runTranslationStage(projectId: string): Promise<ProjectRecord> {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const segments = store.listSegments(projectId);
  if (segments.length === 0) throw new Error('No dialogue segments available to translate.');
  const speakers = store.listSpeakers(projectId);

  store.updateProject(projectId, {
    progressPct: 54,
    currentStep: 'Translating dialogue into natural Khmer & tagging emotions...',
    errorMessage: null,
  });

  const batchSize = 24;
  let previousContext = '';
  const translatedByIdx = new Map<number, { khmerText: string; emotion: SegmentRecord['emotion']; actingNotes: string }>();

  for (let start = 0; start < segments.length; start += batchSize) {
    if (start > 0) {
      await sleep(getRecommendedPacingMs('gemini'));
    }
    const batch = segments.slice(start, start + batchSize);
    const pct = 54 + Math.round(((start + batch.length) / segments.length) * 16);
    store.updateProject(projectId, {
      progressPct: pct,
      currentStep: `Translating dialogue batch ${Math.floor(start / batchSize) + 1}/${Math.ceil(segments.length / batchSize)}...`,
    });

    const results = await runWithProjectRetryObserver(projectId, () =>
      translateBatchToKhmer({
        segments: batch,
        speakers,
        storySummary: project.storySummary ?? 'Conversational video dialogue',
        previousContext,
        geminiModel: project.targetGeminiModel,
      })
    );

    for (const r of results) {
      translatedByIdx.set(r.idx, {
        khmerText: r.khmerText,
        emotion: r.emotion,
        actingNotes: r.actingNotes,
      });
    }

    previousContext = batch
      .slice(-4)
      .map((b) => {
        const t = translatedByIdx.get(b.idx);
        return `[${b.speakerId}] ${b.sourceText} => ${t?.khmerText ?? ''}`;
      })
      .join('\n');
  }

  for (const seg of segments) {
    const tr = translatedByIdx.get(seg.idx);
    if (tr) {
      store.updateSegment(seg.id, {
        khmerText: tr.khmerText,
        emotion: tr.emotion,
        actingNotes: tr.actingNotes,
        status: 'translated',
      });
    }
  }

  return store.updateProject(projectId, {
    status: 'translated',
    progressPct: 70,
    currentStep: `Khmer contextual translation & emotion acting complete (${segments.length} lines).`,
  })!;
}

export async function synthesizeSingleSegment(projectId: string, segmentId: string): Promise<SegmentRecord> {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const seg = store.getSegment(segmentId);
  if (!seg || seg.projectId !== projectId) throw new Error('Segment not found');

  const settings = store.getSettings();
  const speakers = store.listSpeakers(projectId);
  const speaker = speakers.find((sp) => sp.speakerId === seg.speakerId);
  const allSegments = store.listSegments(projectId);
  const nextSeg = allSegments.find((s) => s.idx === seg.idx + 1);

  const clonedProfile = speaker?.clonedVoiceId ? store.getVoiceProfile(speaker.clonedVoiceId) : null;
  const presetProfile = !clonedProfile
    ? store.listVoiceProfiles().find((v) => !v.isCloned && v.baseVoice === (speaker?.assignedVoice ?? seg.voiceName))
    : null;

  const targetVoice = clonedProfile?.baseVoice ?? speaker?.assignedVoice ?? seg.voiceName ?? 'Kore';
  const personaStyle = clonedProfile?.stylePrompt ?? presetProfile?.stylePrompt ?? '';
  const pitchOffset = (speaker?.pitchOffset ?? 0) + (seg.pitchShift ?? 0);
  const userSpeed = (speaker?.speedScale ?? 1.0) * (seg.speechSpeed ?? 1.0);

  const workDir = getProjectWorkDir(projectId);
  const rawWavPath = path.join(workDir, 'tts_raw', `seg_${String(seg.idx).padStart(4, '0')}.wav`);
  const fitWavPath = path.join(workDir, 'tts_fit', `seg_${String(seg.idx).padStart(4, '0')}.wav`);

  const textToSpeak = (seg.khmerText || seg.sourceText).trim();
  await generateKhmerTtsWav({
    khmerText: textToSpeak,
    voiceName: targetVoice,
    emotion: seg.emotion,
    actingNotes: seg.actingNotes,
    personaStyle,
    useExpressiveModel: Boolean(clonedProfile),
    outWavPath: rawWavPath,
  });

  // Compute safe window before next segment starts (so lines never overlap)
  const ownWindow = Math.max(0.8, seg.endTime - seg.startTime);
  const gapToNext = nextSeg ? Math.max(ownWindow, nextSeg.startTime - seg.startTime - 0.05) : ownWindow + 1.5;

  const adjusted = await adjustAudioSegment(
    rawWavPath,
    fitWavPath,
    gapToNext,
    userSpeed,
    pitchOffset,
    settings.autoSpeedFitEnabled,
    settings.maxSpeedFitRatio
  );

  const updated = store.updateSegment(seg.id, {
    voiceName: targetVoice,
    ttsAudioPath: fitWavPath,
    ttsDurationSec: adjusted.finalDurationSec,
    status: 'synthesized',
  });

  return updated!;
}

export async function runTtsStage(projectId: string): Promise<ProjectRecord> {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const segments = store.listSegments(projectId);
  if (segments.length === 0) throw new Error('No dialogue segments found.');

  store.updateProject(projectId, {
    progressPct: 72,
    currentStep: 'Generating expressive Khmer AI voices...',
    errorMessage: null,
  });

  let synthesizedNewCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const pct = 72 + Math.round(((i + 1) / segments.length) * 18);

    if (seg.status === 'synthesized' && seg.ttsAudioPath && fs.existsSync(seg.ttsAudioPath)) {
      store.updateProject(projectId, {
        progressPct: pct,
        currentStep: `Reusing synthesized Khmer voice ${i + 1}/${segments.length}...`,
      });
      continue;
    }

    if (synthesizedNewCount > 0) {
      await sleep(getRecommendedPacingMs('gemini'));
    }

    store.updateProject(projectId, {
      progressPct: pct,
      currentStep: `Synthesizing Khmer voice ${i + 1}/${segments.length} (${seg.emotion})...`,
    });
    await runWithProjectRetryObserver(projectId, () => synthesizeSingleSegment(projectId, seg.id));
    synthesizedNewCount += 1;
  }

  return store.updateProject(projectId, {
    status: 'dubbed',
    progressPct: 90,
    currentStep: `Generated ${segments.length} expressive Khmer dialogue clips.`,
  })!;
}

export async function runMixAndPreviewStage(projectId: string): Promise<ProjectRecord> {
  const project = store.getProject(projectId);
  if (!project) throw new Error('Project not found');
  const segments = store.listSegments(projectId);
  const workDir = getProjectWorkDir(projectId);
  const probe = await probeMedia(project.videoPath);

  store.updateProject(projectId, {
    progressPct: 93,
    currentStep: 'Synchronizing Khmer dialogue & mixing with background audio...',
    errorMessage: null,
  });

  const mixedAudioPath = path.join(workDir, 'mixed_dub.wav');
  const previewVideoPath = path.join(workDir, 'preview_dubbed.mp4');

  await mixAudioAndCreatePreview({
    videoPath: project.videoPath,
    hasOriginalAudio: probe.hasAudio,
    durationSec: probe.durationSec || project.durationSec,
    segments,
    bgmVolume: project.bgmVolume,
    dubVolume: project.dubVolume,
    voiceReductionMode: project.voiceReductionMode,
    mixedAudioOutPath: mixedAudioPath,
    previewVideoOutPath: previewVideoPath,
  });

  return store.updateProject(projectId, {
    mixedAudioPath,
    previewVideoPath,
    status: 'mixed',
    progressPct: 100,
    currentStep: 'Synchronized Khmer dub preview is ready!',
  })!;
}

export async function runFullAutoDubbing(projectId: string): Promise<void> {
  try {
    await runAsrStage(projectId);
    await runDiarizationStage(projectId);
    await runTranslationStage(projectId);
    await runTtsStage(projectId);
    await runMixAndPreviewStage(projectId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.updateProject(projectId, {
      status: 'error',
      errorMessage: msg,
      currentStep: `Pipeline paused: ${msg}`,
    });
  }
}

export async function runExportJob(jobId: string, projectId: string, resolution: '720p' | '1080p' | '4k' | 'original', codec: 'h264' | 'h265', exportSrt: boolean): Promise<void> {
  const project = store.getProject(projectId);
  if (!project) {
    store.updateExportJob(jobId, { status: 'failed', errorMessage: 'Project not found' });
    return;
  }

  try {
    store.updateExportJob(jobId, { status: 'running', progressPct: 2 });

    // Ensure mixed audio exists (build it if user changed volume/segments)
    const updatedProj = await runMixAndPreviewStage(projectId);
    const audioSource = updatedProj.mixedAudioPath ?? updatedProj.videoPath;

    const exportDir = path.resolve(process.cwd(), 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const safeSlug = project.name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'dubbed_video';
    const ts = Date.now();
    const outMp4Path = path.join(exportDir, `${safeSlug}_khmer_${resolution}_${ts}.mp4`);
    const outSrtPath = path.join(exportDir, `${safeSlug}_khmer_${ts}.srt`);

    const segments = store.listSegments(projectId);
    if (exportSrt && segments.length > 0) {
      writeKhmerSrt(segments, outSrtPath);
    }

    await exportFinalMp4({
      videoPath: project.videoPath,
      audioPath: audioSource,
      durationSec: updatedProj.durationSec,
      resolution,
      codec,
      outputMp4Path: outMp4Path,
      onProgress: (pct, etaSeconds) => {
        store.updateExportJob(jobId, { progressPct: pct, etaSeconds });
      },
    });

    store.updateExportJob(jobId, {
      status: 'completed',
      progressPct: 100,
      etaSeconds: 0,
      outputPath: outMp4Path,
      srtPath: exportSrt ? outSrtPath : null,
    });

    store.updateProject(projectId, {
      exportedMp4Path: outMp4Path,
      exportedSrtPath: exportSrt ? outSrtPath : updatedProj.exportedSrtPath,
      status: 'exported',
      progressPct: 100,
      currentStep: 'Final Khmer MP4 video exported and ready to download!',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.updateExportJob(jobId, {
      status: 'failed',
      errorMessage: msg,
    });
  }
}
