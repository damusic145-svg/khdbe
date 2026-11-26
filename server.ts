import 'dotenv/config';
import * as archiverMod from 'archiver';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import multer from 'multer';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  analyzeVoiceSampleForCloning,
  generateKhmerTtsWav,
  generateSampleEnglishSpeechWav,
} from './server/ai.ts';
import { store } from './server/db.ts';
import { createDemoVideoFromSpeechClips, probeMedia } from './server/ffmpeg.ts';
import {
  getProviderPoolStatus,
  getRecommendedPacingMs,
  isRateLimitError,
  testStoredApiKey,
} from './server/keyRotation.ts';
import {
  getProjectWorkDir,
  runAsrStage,
  runDiarizationStage,
  runExportJob,
  runFullAutoDubbing,
  runMixAndPreviewStage,
  runTranslationStage,
  runTtsStage,
  synthesizeSingleSegment,
} from './server/pipeline.ts';
import type { EmotionType } from './server/types.ts';
import { SUPPORTED_EMOTIONS } from './server/types.ts';

const PORT = 3000;
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const VOICES_DIR = path.resolve(process.cwd(), '.data', 'voices');
const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
const DATA_DIR = path.resolve(process.cwd(), '.data');
const WINDOWS_BUNDLE_DIR = path.resolve(process.cwd(), 'windows_desktop');

for (const dir of [UPLOADS_DIR, VOICES_DIR, EXPORTS_DIR, DATA_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function isPathConfined(targetPath: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(targetPath);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });
}

function streamMediaFile(req: express.Request, res: express.Response, filePath: string, contentType: string): void {
  if (!fs.existsSync(filePath) || !isPathConfined(filePath, [UPLOADS_DIR, DATA_DIR, EXPORTS_DIR])) {
    res.status(404).json({ error: 'Media file not found' });
    return;
  }
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize || end >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const safeExt = /^[.][a-z0-9]{2,6}$/.test(ext) ? ext : '.mp4';
    cb(null, `${Date.now()}_${crypto.randomUUID().slice(0, 8)}${safeExt}`);
  },
});

const voiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VOICES_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.wav';
    const safeExt = /^[.][a-z0-9]{2,6}$/.test(ext) ? ext : '.wav';
    cb(null, `sample_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${safeExt}`);
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 1024 * 1024 * 1024 },
});

const uploadVoice = multer({
  storage: voiceStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'AI Khmer Dubber Pro' });
  });

  // Settings & Provider Pool Status
  app.get('/api/settings', (_req, res) => {
    res.json({
      settings: store.getSettings(),
      poolStatus: getProviderPoolStatus(),
    });
  });

  app.put('/api/settings', (req, res) => {
    const updated = store.updateSettings(req.body ?? {});
    res.json({ settings: updated });
  });

  // API Key Management (Gemini & Groq Rotation Pool)
  app.get('/api/keys', (req, res) => {
    const provider = req.query.provider === 'gemini' || req.query.provider === 'groq' ? req.query.provider : undefined;
    res.json({
      keys: store.listApiKeys(provider),
      poolStatus: getProviderPoolStatus(),
    });
  });

  app.post('/api/keys', (req, res) => {
    const { provider, label, apiKey } = req.body ?? {};
    if (provider !== 'gemini' && provider !== 'groq') {
      res.status(400).json({ error: 'Provider must be gemini or groq.' });
      return;
    }
    if (typeof apiKey !== 'string' || apiKey.trim().length < 10) {
      res.status(400).json({ error: 'Please provide a valid API key.' });
      return;
    }
    const created = store.addApiKey(provider, typeof label === 'string' ? label : `${provider.toUpperCase()} Key`, apiKey);
    res.status(201).json({ key: created, poolStatus: getProviderPoolStatus() });
  });

  app.patch('/api/keys/:id', (req, res) => {
    const { label, apiKey, isEnabled, status } = req.body ?? {};
    const updated = store.updateApiKey(req.params.id, {
      label: typeof label === 'string' ? label : undefined,
      rawKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey : undefined,
      isEnabled: typeof isEnabled === 'boolean' ? isEnabled : undefined,
      status: status === 'active' || status === 'disabled' ? status : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    res.json({ key: updated, poolStatus: getProviderPoolStatus() });
  });

  app.post('/api/keys/:id/test', async (req, res) => {
    const result = await testStoredApiKey(req.params.id);
    res.json({
      ...result,
      keys: store.listApiKeys(),
      poolStatus: getProviderPoolStatus(),
    });
  });

  app.delete('/api/keys/:id', (req, res) => {
    const ok = store.deleteApiKey(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    res.json({ ok: true, poolStatus: getProviderPoolStatus() });
  });

  // Voice Profiles & Authorized Voice Cloning
  app.get('/api/voices', (_req, res) => {
    res.json({ voices: store.listVoiceProfiles() });
  });

  app.post('/api/voices/clone', uploadVoice.single('sample'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Audio sample file is required.' });
        return;
      }
      const { name, description, consentConfirmed } = req.body ?? {};
      if (consentConfirmed !== 'true' && consentConfirmed !== true) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'You must confirm ownership or permission to use this voice sample.' });
        return;
      }

      const probe = await probeMedia(req.file.path);
      const analysis = await analyzeVoiceSampleForCloning(req.file.path);

      const created = store.createVoiceProfile({
        name: (typeof name === 'string' && name.trim()) || path.parse(req.file.originalname).name,
        description:
          (typeof description === 'string' && description.trim()) ||
          'Authorized cloned voice profile analyzed for Khmer dubbing.',
        gender: analysis.gender,
        baseVoice: analysis.recommendedBaseVoice,
        samplePath: req.file.path,
        sampleDurationSec: probe.durationSec,
        isCloned: true,
        consentConfirmed: true,
        stylePrompt: analysis.stylePrompt,
        pitchDefault: 0,
        speedDefault: 1.0,
      });

      res.status(201).json({ voice: created });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/voices/:id/preview', async (req, res) => {
    try {
      const voice = store.getVoiceProfile(req.params.id);
      if (!voice) {
        res.status(404).json({ error: 'Voice profile not found.' });
        return;
      }
      const sampleText =
        typeof req.body?.text === 'string' && req.body.text.trim()
          ? req.body.text.trim()
          : 'សួស្តី! នេះគឺជាការសាកល្បងសំឡេងបញ្ចូលខ្មែរដោយ AI Khmer Dubber Pro។';
      const emotion: EmotionType = SUPPORTED_EMOTIONS.includes(req.body?.emotion) ? req.body.emotion : 'Happy';
      const previewPath = path.join(VOICES_DIR, `preview_${voice.id}_${Date.now()}.wav`);

      await generateKhmerTtsWav({
        khmerText: sampleText,
        voiceName: voice.baseVoice,
        emotion,
        personaStyle: voice.stylePrompt,
        useExpressiveModel: voice.isCloned,
        outWavPath: previewPath,
      });

      const buf = fs.readFileSync(previewPath);
      try {
        fs.unlinkSync(previewPath);
      } catch {
        // ignore
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.send(buf);
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/voices/:id', (req, res) => {
    const ok = store.deleteVoiceProfile(req.params.id);
    if (!ok) {
      res.status(400).json({ error: 'Built-in voices cannot be deleted or voice not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Projects CRUD & Media Import
  app.get('/api/projects', (_req, res) => {
    res.json({ projects: store.listProjects() });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({
      project,
      segments: store.listSegments(project.id),
      speakers: store.listSpeakers(project.id),
    });
  });

  app.post('/api/projects/import', uploadVideo.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Video file is required.' });
        return;
      }
      const settings = store.getSettings();
      const probe = await probeMedia(req.file.path);
      const projId = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const cleanName =
        (typeof req.body?.name === 'string' && req.body.name.trim()) ||
        path.parse(req.file.originalname).name;

      const project = store.createProject({
        id: projId,
        name: cleanName,
        originalFilename: req.file.originalname,
        videoPath: req.file.path,
        audioWavPath: null,
        previewVideoPath: null,
        mixedAudioPath: null,
        exportedMp4Path: null,
        exportedSrtPath: null,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasEmbeddedSubtitles: probe.hasEmbeddedSubtitles,
        sourceLanguage: typeof req.body?.sourceLanguage === 'string' ? req.body.sourceLanguage : 'auto',
        targetGeminiModel: settings.defaultGeminiModel,
        asrEngine: settings.defaultAsrEngine,
        status: 'imported',
        progressPct: 0,
        currentStep: 'Imported and analyzed. Click START AUTO DUBBING to begin.',
        errorMessage: null,
        bgmVolume: settings.defaultBgmVolume,
        dubVolume: settings.defaultDubVolume,
        voiceReductionMode: 'soft',
        outputResolution: '1080p',
        videoCodec: 'h264',
        outputFolder: settings.defaultOutputFolder,
        storySummary: null,
      });

      res.status(201).json({ project });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Real FFmpeg + Gemini TTS Sample Video Builder so users can test end-to-end immediately
  app.post('/api/projects/create-demo', async (_req, res) => {
    try {
      const settings = store.getSettings();
      const projId = `proj-${crypto.randomUUID().slice(0, 8)}`;
      const workDir = getProjectWorkDir(projId);
      const clip1 = path.join(workDir, 'demo_c1.wav');
      const clip2 = path.join(workDir, 'demo_c2.wav');
      const clip3 = path.join(workDir, 'demo_c3.wav');
      const demoMp4 = path.join(UPLOADS_DIR, `demo_dialogue_${projId}.mp4`);

      const pacingMs = getRecommendedPacingMs('gemini');
      await generateSampleEnglishSpeechWav(
        'Maya, wait! Did you hear that strange sound coming from the old library?',
        'Puck',
        'Urgent, curious, slightly hushed',
        clip1
      );
      await new Promise((r) => setTimeout(r, pacingMs));
      await generateSampleEnglishSpeechWav(
        'I heard it too, Daniel. Stay calm and let us check inside together.',
        'Kore',
        'Steady, reassuring, calm female voice',
        clip2
      );
      await new Promise((r) => setTimeout(r, pacingMs));
      await generateSampleEnglishSpeechWav(
        'Look at that golden light! We finally found the ancient Khmer manuscript!',
        'Puck',
        'Excited, amazed, joyful discovery',
        clip3
      );

      await createDemoVideoFromSpeechClips(
        [
          { wavPath: clip1, startSec: 0.6 },
          { wavPath: clip2, startSec: 5.6 },
          { wavPath: clip3, startSec: 10.6 },
        ],
        demoMp4
      );

      const probe = await probeMedia(demoMp4);
      const project = store.createProject({
        id: projId,
        name: 'The Ancient Manuscript (Two-Speaker Demo)',
        originalFilename: 'demo_two_speaker_scene.mp4',
        videoPath: demoMp4,
        audioWavPath: null,
        previewVideoPath: null,
        mixedAudioPath: null,
        exportedMp4Path: null,
        exportedSrtPath: null,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasEmbeddedSubtitles: false,
        sourceLanguage: 'en',
        targetGeminiModel: settings.defaultGeminiModel,
        asrEngine: settings.defaultAsrEngine,
        status: 'imported',
        progressPct: 0,
        currentStep: 'Demo scene generated with real audio & music. Click START AUTO DUBBING!',
        errorMessage: null,
        bgmVolume: settings.defaultBgmVolume,
        dubVolume: settings.defaultDubVolume,
        voiceReductionMode: 'soft',
        outputResolution: '720p',
        videoCodec: 'h264',
        outputFolder: settings.defaultOutputFolder,
        storySummary: null,
      });

      res.status(201).json({ project });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/projects/:id', (req, res) => {
    const updated = store.updateProject(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project: updated });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const proj = store.getProject(req.params.id);
    if (!proj) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    store.deleteProject(proj.id);
    res.json({ ok: true });
  });

  // Pipeline Stages & One-Click Auto Dubbing
  app.post('/api/projects/:id/auto-dub', (req, res) => {
    const proj = store.getProject(req.params.id);
    if (!proj) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    store.updateProject(proj.id, {
      status: 'analyzing',
      progressPct: 2,
      currentStep: 'Starting automatic dubbing pipeline...',
      errorMessage: null,
    });
    void runFullAutoDubbing(proj.id);
    res.json({ started: true, projectId: proj.id });
  });

  app.post('/api/projects/:id/stage/asr', async (req, res) => {
    try {
      const project = await runAsrStage(req.params.id);
      res.json({ project, segments: store.listSegments(project.id) });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/projects/:id/stage/diarize', async (req, res) => {
    try {
      const project = await runDiarizationStage(req.params.id);
      res.json({
        project,
        segments: store.listSegments(project.id),
        speakers: store.listSpeakers(project.id),
      });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/projects/:id/stage/translate', async (req, res) => {
    try {
      const project = await runTranslationStage(req.params.id);
      res.json({ project, segments: store.listSegments(project.id) });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/projects/:id/stage/tts', async (req, res) => {
    try {
      const project = await runTtsStage(req.params.id);
      res.json({ project, segments: store.listSegments(project.id) });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/projects/:id/stage/mix', async (req, res) => {
    try {
      const project = await runMixAndPreviewStage(req.params.id);
      res.json({ project });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Segment & Speaker Editing
  app.patch('/api/projects/:id/segments/:segId', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const needsResynth =
      body.khmerText !== undefined ||
      body.emotion !== undefined ||
      body.actingNotes !== undefined ||
      body.speechSpeed !== undefined ||
      body.pitchShift !== undefined ||
      body.voiceName !== undefined;
    const patch = needsResynth ? { ...body, status: 'translated' as const } : body;
    const updated = store.updateSegment(req.params.segId, patch);
    if (!updated) {
      res.status(404).json({ error: 'Segment not found.' });
      return;
    }
    res.json({ segment: updated });
  });

  app.post('/api/projects/:id/segments/:segId/synthesize', async (req, res) => {
    try {
      const updated = await synthesizeSingleSegment(req.params.id, req.params.segId);
      res.json({ segment: updated });
    } catch (err) {
      const code = isRateLimitError(err) ? 429 : 500;
      res.status(code).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/projects/:id/speakers/:speakerRowId', (req, res) => {
    const updated = store.updateSpeaker(req.params.speakerRowId, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Speaker not found.' });
      return;
    }
    const voiceChanged =
      req.body?.assignedVoice !== undefined ||
      req.body?.clonedVoiceId !== undefined ||
      req.body?.pitchOffset !== undefined ||
      req.body?.speedScale !== undefined;
    if (voiceChanged) {
      const cloned = updated.clonedVoiceId ? store.getVoiceProfile(updated.clonedVoiceId) : null;
      const effectiveVoice = cloned ? cloned.baseVoice : updated.assignedVoice;
      const segs = store.listSegments(req.params.id);
      for (const s of segs) {
        if (s.speakerId === updated.speakerId) {
          store.updateSegment(s.id, {
            voiceName: effectiveVoice,
            status: s.khmerText ? 'translated' : 'pending',
          });
        }
      }
    }
    res.json({
      speaker: updated,
      segments: store.listSegments(req.params.id),
    });
  });

  // Media Streaming Endpoints
  app.get('/api/projects/:id/media/original', (req, res) => {
    const proj = store.getProject(req.params.id);
    if (!proj) {
      res.status(404).end();
      return;
    }
    streamMediaFile(req, res, proj.videoPath, 'video/mp4');
  });

  app.get('/api/projects/:id/media/preview', (req, res) => {
    const proj = store.getProject(req.params.id);
    if (!proj) {
      res.status(404).end();
      return;
    }
    const target = proj.previewVideoPath && fs.existsSync(proj.previewVideoPath) ? proj.previewVideoPath : proj.videoPath;
    streamMediaFile(req, res, target, 'video/mp4');
  });

  app.get('/api/projects/:id/segments/:segId/audio', (req, res) => {
    const seg = store.getSegment(req.params.segId);
    if (!seg || seg.projectId !== req.params.id || !seg.ttsAudioPath) {
      res.status(404).end();
      return;
    }
    streamMediaFile(req, res, seg.ttsAudioPath, 'audio/wav');
  });

  // Batch Export & Downloads
  app.get('/api/exports', (_req, res) => {
    res.json({ jobs: store.listExportJobs() });
  });

  app.post('/api/exports', (req, res) => {
    const { projectId, resolution, codec, exportSrt } = req.body ?? {};
    const project = store.getProject(String(projectId));
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const jobId = `exp-${crypto.randomUUID().slice(0, 8)}`;
    const resVal = resolution === '720p' || resolution === '4k' || resolution === 'original' ? resolution : '1080p';
    const codecVal = codec === 'h265' ? 'h265' : 'h264';
    const srtFlag = exportSrt !== false;

    const job = store.createExportJob({
      id: jobId,
      projectId: project.id,
      projectName: project.name,
      resolution: resVal,
      codec: codecVal,
      exportSrt: srtFlag,
      status: 'queued',
      progressPct: 0,
      etaSeconds: null,
      outputPath: null,
      srtPath: null,
      errorMessage: null,
    });

    void runExportJob(jobId, project.id, resVal, codecVal, srtFlag);
    res.status(201).json({ job });
  });

  app.get('/api/exports/:jobId/download', (req, res) => {
    const jobs = store.listExportJobs();
    const job = jobs.find((j) => j.id === req.params.jobId);
    const kind = req.query.kind === 'srt' ? 'srt' : 'mp4';
    const targetPath = kind === 'srt' ? job?.srtPath : job?.outputPath;
    if (!targetPath || !fs.existsSync(targetPath) || !isPathConfined(targetPath, [EXPORTS_DIR, DATA_DIR])) {
      res.status(404).json({ error: 'Exported file not found.' });
      return;
    }
    res.download(targetPath, path.basename(targetPath));
  });

  // Download complete Windows 10/11 Desktop Source + PyInstaller + Inno Setup + GitHub Actions Bundle
  app.get('/api/windows-bundle/download', (_req, res) => {
    if (!fs.existsSync(WINDOWS_BUNDLE_DIR)) {
      res.status(404).json({ error: 'Windows desktop bundle directory not found.' });
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="AI_Khmer_Dubber_Pro_Windows_Source.zip"');
    const ZipArchiveCtor = (
      archiverMod as unknown as {
        ZipArchive: new (opts?: { zlib?: { level?: number } }) => {
          on(event: string, listener: (err: Error) => void): void;
          pipe(dest: NodeJS.WritableStream): void;
          directory(dirpath: string, destpath: string | false): void;
          finalize(): Promise<void>;
        };
      }
    ).ZipArchive;
    const archive = new ZipArchiveCtor({ zlib: { level: 9 } });
    archive.on('error', (err: Error) => res.status(500).end(err.message));
    archive.pipe(res);
    archive.directory(WINDOWS_BUNDLE_DIR, false);
    void archive.finalize();
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Khmer Dubber Pro server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
