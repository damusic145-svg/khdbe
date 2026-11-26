# AI Khmer Dubber Pro — Windows 10/11 Desktop Edition

Automatic AI Video Dubbing Software for Windows 10 & Windows 11.

## Included Modules

- `main.py` — PySide6 Windows 11 desktop UI (15 views)
- `app/database.py` — SQLite local storage & Fernet-encrypted API key vault
- `app/key_manager.py` — Unlimited Gemini & Groq API key rotation with automatic cooldown
- `app/services/video_analyzer.py` — FFmpeg/FFprobe analysis, embedded subtitle extraction, and audio chunking
- `app/services/asr_groq.py` — Groq Whisper (`whisper-large-v3-turbo`) speech recognition
- `app/services/diarizer.py` — Speaker detection & character voice assignment
- `app/services/translator_gemini.py` — Google Gemini contextual Khmer translation & 12 emotions
- `app/services/tts_khmer.py` — Khmer neural voices (`km-KH-PisethNeural`, `km-KH-SreymomNeural`) with emotion prosody
- `app/services/voice_cloner.py` — Authorized voice cloning sample profile manager
- `app/services/audio_sync.py` — FFmpeg dialogue speed fitting, vocal reduction, and BGM ducking
- `app/services/exporter.py` — MP4 export (720p / 1080p / 4K, H.264 / H.265) and Khmer `.srt` export

## Build `AI_Khmer_Dubber_Pro_Setup.exe` Without Installing Python Locally (GitHub Actions)

1. Create a GitHub repository and push the contents of this `windows_desktop` folder to `main`.
2. Open the **Actions** tab on GitHub.
3. Run **Build Windows Installer (AI_Khmer_Dubber_Pro_Setup.exe)**.
4. Download the compiled `AI_Khmer_Dubber_Pro_Setup.exe` artifact directly from the workflow run.

## Local Windows Build (Optional)

1. Install Python 3.11+, FFmpeg (`ffmpeg/bin/ffmpeg.exe` & `ffprobe.exe`), and Inno Setup 6.
2. `pip install -r requirements.txt`
3. `pyinstaller --clean --noconfirm build_windows.spec`
4. `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\AI_Khmer_Dubber_Pro.iss`
5. Run `dist_installer\AI_Khmer_Dubber_Pro_Setup.exe`.
