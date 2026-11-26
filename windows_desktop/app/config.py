from pathlib import Path
import os

APP_NAME = "AI Khmer Dubber Pro"
APP_VERSION = "1.0.0"

APPDATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share")) / "AIKhmerDubberPro"
DB_PATH = APPDATA_DIR / "dubber_pro.sqlite"
PROJECTS_DIR = APPDATA_DIR / "projects"
VOICES_DIR = APPDATA_DIR / "voice_samples"
DEFAULT_EXPORT_DIR = Path.home() / "Videos" / "AI Khmer Dubber Pro"

EMOTIONS = [
    "Happy",
    "Sad",
    "Angry",
    "Excited",
    "Romantic",
    "Scared",
    "Serious",
    "Calm",
    "Whispering",
    "Crying",
    "Shouting",
    "Surprised",
]

GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
]

KHMER_VOICES = {
    "km-KH-PisethNeural": {"label": "Piseth (Khmer Male)", "gender": "male"},
    "km-KH-SreymomNeural": {"label": "Sreymom (Khmer Female)", "gender": "female"},
}

for d in (APPDATA_DIR, PROJECTS_DIR, VOICES_DIR, DEFAULT_EXPORT_DIR):
    d.mkdir(parents=True, exist_ok=True)
