import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SegmentRecord } from './types.ts';

const execFileAsync = promisify(execFile);

export interface MediaProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasEmbeddedSubtitles: boolean;
}

export interface ParsedSubtitleCue {
  startTime: number;
  endTime: number;
  text: string;
}

function parseFractionFps(raw?: string): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num / den)) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      duration?: string;
    }>;
  };

  const streams = data.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const subStream = streams.find((s) => s.codec_type === 'subtitle');

  const durationSec = Number(data.format?.duration ?? videoStream?.duration ?? audioStream?.duration ?? 0) || 0;

  return {
    durationSec,
    width: videoStream?.width ?? 1920,
    height: videoStream?.height ?? 1080,
    fps: parseFractionFps(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
    hasAudio: Boolean(audioStream),
    hasEmbeddedSubtitles: Boolean(subStream),
  };
}

function parseSrtTimestamp(ts: string): number {
  const m = ts.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) return 0;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

export function parseSrtContent(srtText: string): ParsedSubtitleCue[] {
  const normalized = srtText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n\s*\n/);
  const cues: ParsedSubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timingLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timingLineIdx].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    const startTime = parseSrtTimestamp(startRaw);
    const endTime = parseSrtTimestamp(endRaw);
    const text = lines
      .slice(timingLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text && endTime > startTime) {
      cues.push({ startTime, endTime, text });
    }
  }
  return cues;
}

export async function extractEmbeddedSubtitles(videoPath: string, outSrtPath: string): Promise<ParsedSubtitleCue[]> {
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      videoPath,
      '-map',
      '0:s:0',
      '-c:s',
      'srt',
      outSrtPath,
    ]);
    if (fs.existsSync(outSrtPath)) {
      const content = fs.readFileSync(outSrtPath, 'utf8');
      return parseSrtContent(content);
    }
  } catch {
    // No extractable text subtitles
  }
  return [];
}

export async function extractAudioWav(videoPath: string, outWavPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    outWavPath,
  ]);
}

export interface AudioChunkInfo {
  path: string;
  offsetSec: number;
  durationSec: number;
}

export async function splitAudioChunks(
  wavPath: string,
  chunkDir: string,
  chunkSec: number,
  totalDurationSec: number
): Promise<AudioChunkInfo[]> {
  fs.mkdirSync(chunkDir, { recursive: true });
  const safeChunkSec = Math.max(20, Math.min(300, chunkSec));
  const chunks: AudioChunkInfo[] = [];

  if (totalDurationSec <= safeChunkSec) {
    const outPath = path.join(chunkDir, 'chunk_000.mp3');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      wavPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      outPath,
    ]);
    chunks.push({ path: outPath, offsetSec: 0, durationSec: totalDurationSec });
    return chunks;
  }

  let offset = 0;
  let idx = 0;
  while (offset < totalDurationSec) {
    const dur = Math.min(safeChunkSec, totalDurationSec - offset);
    if (dur < 0.4) break;
    const outPath = path.join(chunkDir, `chunk_${String(idx).padStart(3, '0')}.mp3`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(offset),
      '-t',
      String(dur),
      '-i',
      wavPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      outPath,
    ]);
    chunks.push({ path: outPath, offsetSec: offset, durationSec: dur });
    offset += safeChunkSec;
    idx += 1;
  }
  return chunks;
}

function buildAtempoFilters(speed: number): string[] {
  const filters: string[] = [];
  let remaining = Math.max(0.5, Math.min(2.5, speed));
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1.0) > 0.01) {
    filters.push(`atempo=${remaining.toFixed(4)}`);
  }
  return filters;
}

export async function adjustAudioSegment(
  inputWav: string,
  outputWav: string,
  maxWindowSec: number,
  userSpeedScale: number,
  pitchSemitones: number,
  autoSpeedFit: boolean,
  maxSpeedFitRatio: number
): Promise<{ finalDurationSec: number; effectiveSpeed: number }> {
  const probe = await probeMedia(inputWav);
  const rawDuration = Math.max(0.1, probe.durationSec);

  let effectiveSpeed = Math.max(0.75, Math.min(1.6, userSpeedScale || 1.0));
  if (autoSpeedFit && maxWindowSec > 0.25) {
    const projectedDur = rawDuration / effectiveSpeed;
    if (projectedDur > maxWindowSec) {
      const neededRatio = rawDuration / maxWindowSec;
      effectiveSpeed = Math.min(Math.max(effectiveSpeed, neededRatio), maxSpeedFitRatio || 1.35);
    }
  }

  const filterParts: string[] = [];
  if (Math.abs(pitchSemitones) >= 0.25) {
    const pitchFactor = Math.pow(2, pitchSemitones / 12);
    // asetrate shifts pitch & speed together, so compensate with atempo
    filterParts.push(`asetrate=24000*${pitchFactor.toFixed(5)}`);
    filterParts.push('aresample=24000');
    filterParts.push(...buildAtempoFilters(effectiveSpeed / pitchFactor));
  } else {
    filterParts.push(...buildAtempoFilters(effectiveSpeed));
  }

  filterParts.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  fs.mkdirSync(path.dirname(outputWav), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputWav,
    '-af',
    filterParts.join(','),
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'pcm_s16le',
    outputWav,
  ]);

  const finalProbe = await probeMedia(outputWav);
  return {
    finalDurationSec: finalProbe.durationSec,
    effectiveSpeed,
  };
}

export async function mixAudioAndCreatePreview(opts: {
  videoPath: string;
  hasOriginalAudio: boolean;
  durationSec: number;
  segments: SegmentRecord[];
  bgmVolume: number;
  dubVolume: number;
  voiceReductionMode: 'soft' | 'aggressive' | 'off';
  mixedAudioOutPath: string;
  previewVideoOutPath: string;
}): Promise<void> {
  const readySegments = opts.segments.filter((s) => s.ttsAudioPath && fs.existsSync(s.ttsAudioPath));
  fs.mkdirSync(path.dirname(opts.mixedAudioOutPath), { recursive: true });

  if (readySegments.length === 0) {
    // No TTS clips yet: either copy original audio or create silence
    if (opts.hasOriginalAudio) {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        opts.videoPath,
        '-vn',
        '-af',
        `volume=${opts.bgmVolume.toFixed(2)}`,
        '-ac',
        '2',
        '-ar',
        '44100',
        opts.mixedAudioOutPath,
      ]);
    } else {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=44100:cl=stereo:d=${Math.max(1, opts.durationSec)}`,
        opts.mixedAudioOutPath,
      ]);
    }
  } else {
    // Build FFmpeg filter_complex with non-overlapping timeline alignment
    const args: string[] = ['-y'];
    if (opts.hasOriginalAudio) {
      args.push('-i', opts.videoPath);
    } else {
      args.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${Math.max(1, opts.durationSec + 1)}`);
    }

    for (const seg of readySegments) {
      args.push('-i', seg.ttsAudioPath!);
    }

    const filterLines: string[] = [];

    // Prepare base / BGM track with optional center-channel vocal attenuation
    let bgmChain = '[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
    if (opts.hasOriginalAudio && opts.voiceReductionMode === 'soft') {
      bgmChain += ',stereotools=mlev=0.45:slev=1.05';
    } else if (opts.hasOriginalAudio && opts.voiceReductionMode === 'aggressive') {
      bgmChain += ',stereotools=mlev=0.18:slev=1.15,highpass=f=85,lowpass=f=12000';
    }
    bgmChain += `,volume=${Math.max(0, Math.min(1.5, opts.bgmVolume)).toFixed(2)},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[bgm_raw]`;
    filterLines.push(bgmChain);

    const dubLabels: string[] = [];
    // Track end time to ensure zero overlap
    let lastEndMs = 0;
    readySegments.forEach((seg, idx) => {
      const inputIdx = idx + 1;
      const desiredStartMs = Math.max(0, Math.round(seg.startTime * 1000));
      const safeStartMs = Math.max(desiredStartMs, lastEndMs);
      const durMs = Math.max(200, Math.round((seg.ttsDurationSec || (seg.endTime - seg.startTime)) * 1000));
      lastEndMs = safeStartMs + durMs + 30;
      const label = `dub${idx}`;
      filterLines.push(
        `[${inputIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${safeStartMs}|${safeStartMs}[${label}]`
      );
      dubLabels.push(`[${label}]`);
    });

    if (dubLabels.length === 1) {
      filterLines.push(
        `${dubLabels[0]}volume=${Math.max(0, Math.min(2.0, opts.dubVolume)).toFixed(2)},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[dub_bus]`
      );
    } else {
      filterLines.push(
        `${dubLabels.join('')}amix=inputs=${dubLabels.length}:duration=longest:normalize=0,volume=${Math.max(
          0,
          Math.min(2.0, opts.dubVolume)
        ).toFixed(2)},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[dub_bus]`
      );
    }

    // Sidechain duck BGM slightly whenever Khmer dialogue speaks
    filterLines.push(
      '[dub_bus]asplit=2[dub_sc][dub_mix]',
      '[bgm_raw][dub_sc]sidechaincompress=threshold=0.025:ratio=3.5:attack=25:release=250,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[bgm_ducked]',
      '[bgm_ducked][dub_mix]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]'
    );

    args.push(
      '-filter_complex',
      filterLines.join(';'),
      '-map',
      '[aout]',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      opts.mixedAudioOutPath
    );

    await execFileAsync('ffmpeg', args);
  }

  // Create fast web-playable preview MP4 muxing original video stream with mixed audio
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    opts.videoPath,
    '-i',
    opts.mixedAudioOutPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-shortest',
    opts.previewVideoOutPath,
  ]);
}

function formatSrtTimestamp(sec: number): string {
  const safe = Math.max(0, sec);
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(
    ms % 1000
  ).padStart(3, '0')}`;
}

export function writeKhmerSrt(segments: SegmentRecord[], outSrtPath: string): void {
  fs.mkdirSync(path.dirname(outSrtPath), { recursive: true });
  const lines = segments.map((seg, i) => {
    const text = (seg.khmerText || seg.sourceText).trim();
    return `${i + 1}\n${formatSrtTimestamp(seg.startTime)} --> ${formatSrtTimestamp(seg.endTime)}\n${text}\n`;
  });
  fs.writeFileSync(outSrtPath, lines.join('\n'), 'utf8');
}

export function exportFinalMp4(opts: {
  videoPath: string;
  audioPath: string;
  durationSec: number;
  resolution: '720p' | '1080p' | '4k' | 'original';
  codec: 'h264' | 'h265';
  outputMp4Path: string;
  onProgress: (pct: number, etaSeconds: number | null) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(opts.outputMp4Path), { recursive: true });

    const scaleFilter =
      opts.resolution === '720p'
        ? 'scale=-2:720'
        : opts.resolution === '1080p'
          ? 'scale=-2:1080'
          : opts.resolution === '4k'
            ? 'scale=-2:2160'
            : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

    const vCodec = opts.codec === 'h265' ? 'libx265' : 'libx264';
    const args = [
      '-y',
      '-i',
      opts.videoPath,
      '-i',
      opts.audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-vf',
      scaleFilter,
      '-c:v',
      vCodec,
      '-preset',
      'medium',
      '-crf',
      opts.codec === 'h265' ? '23' : '19',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-movflags',
      '+faststart',
      '-shortest',
      '-progress',
      'pipe:1',
      opts.outputMp4Path,
    ];

    const startedAt = Date.now();
    const proc = spawn('ffmpeg', args);
    let stderrBuf = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const match = text.match(/out_time_ms=(\d+)/);
      if (match && opts.durationSec > 0) {
        const outSec = Number(match[1]) / 1_000_000;
        const pct = Math.max(1, Math.min(99, Math.round((outSec / opts.durationSec) * 100)));
        const elapsedSec = (Date.now() - startedAt) / 1000;
        const eta = pct > 3 ? Math.max(1, Math.round((elapsedSec / pct) * (100 - pct))) : null;
        opts.onProgress(pct, eta);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    proc.on('close', (code) => {
      if (code === 0) {
        opts.onProgress(100, 0);
        resolve();
      } else {
        reject(new Error(`FFmpeg export failed (exit ${code}): ${stderrBuf.slice(-400)}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

export async function createDemoVideoFromSpeechClips(
  speechClips: Array<{ wavPath: string; startSec: number }>,
  outMp4Path: string
): Promise<void> {
  fs.mkdirSync(path.dirname(outMp4Path), { recursive: true });
  const duration = 16;
  const args: string[] = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=#111827:s=1280x720:r=24:d=${duration}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=220:sample_rate=44100:duration=${duration}`,
  ];

  for (const clip of speechClips) {
    args.push('-i', clip.wavPath);
  }

  const filters: string[] = [
    '[1:a]volume=0.035[bgm]',
  ];
  const mixInputs = ['[bgm]'];
  speechClips.forEach((clip, idx) => {
    const inputIdx = idx + 2;
    const ms = Math.round(clip.startSec * 1000);
    filters.push(`[${inputIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms}[v${idx}]`);
    mixInputs.push(`[v${idx}]`);
  });

  filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0[aout]`);

  // Subtle animated grid / timecode visual on video track using drawbox/geq without requiring external font files
  filters.push(
    `[0:v]drawbox=x=80:y=80:w=1120:h=560:color=#F59E0B@0.25:t=2,drawbox=x=120:y=560:w='min(1040,1040*(t/${duration}))':h=10:color=#F59E0B@0.9:t=fill[vout]`
  );

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outMp4Path
  );

  await execFileAsync('ffmpeg', args);
}
