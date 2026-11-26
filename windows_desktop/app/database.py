import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from cryptography.fernet import Fernet

from app.config import APPDATA_DIR, DB_PATH, DEFAULT_EXPORT_DIR


def _get_fernet() -> Fernet:
    key_file = APPDATA_DIR / ".fernet.key"
    if key_file.exists():
        key = key_file.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        key_file.write_bytes(key)
    return Fernet(key)


def mask_key(raw: str) -> str:
    raw = raw.strip()
    if len(raw) <= 8:
        return "••••••••"
    return f"{raw[:4]}••••••{raw[-4:]}"


class LocalDatabase:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.fernet = _get_fernet()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    video_path TEXT NOT NULL,
                    output_folder TEXT NOT NULL,
                    duration_sec REAL DEFAULT 0,
                    width INTEGER DEFAULT 1920,
                    height INTEGER DEFAULT 1080,
                    fps REAL DEFAULT 30,
                    source_language TEXT DEFAULT 'auto',
                    gemini_model TEXT DEFAULT 'gemini-2.5-flash',
                    status TEXT DEFAULT 'imported',
                    progress_pct INTEGER DEFAULT 0,
                    current_step TEXT DEFAULT 'Ready',
                    bgm_volume REAL DEFAULT 0.35,
                    dub_volume REAL DEFAULT 1.0,
                    voice_reduction TEXT DEFAULT 'soft',
                    story_summary TEXT DEFAULT '',
                    exported_mp4 TEXT,
                    exported_srt TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS segments (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    speaker_id TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    khmer_text TEXT DEFAULT '',
                    emotion TEXT DEFAULT 'Calm',
                    acting_notes TEXT DEFAULT '',
                    voice_name TEXT DEFAULT 'km-KH-SreymomNeural',
                    speech_speed REAL DEFAULT 1.0,
                    pitch_shift REAL DEFAULT 0.0,
                    tts_path TEXT,
                    tts_duration REAL DEFAULT 0.0,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS speakers (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    speaker_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    gender TEXT DEFAULT 'neutral',
                    assigned_voice TEXT DEFAULT 'km-KH-SreymomNeural',
                    cloned_voice_id TEXT,
                    pitch_offset REAL DEFAULT 0.0,
                    speed_scale REAL DEFAULT 1.0,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS voice_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    gender TEXT NOT NULL,
                    sample_path TEXT NOT NULL,
                    consent_confirmed INTEGER DEFAULT 1,
                    notes TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS api_keys (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    label TEXT NOT NULL,
                    encrypted_key TEXT NOT NULL,
                    key_hint TEXT NOT NULL,
                    is_enabled INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'active',
                    usage_count INTEGER DEFAULT 0,
                    error_count INTEGER DEFAULT 0,
                    last_error TEXT,
                    cooldown_until REAL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            defaults = {
                "output_folder": str(DEFAULT_EXPORT_DIR),
                "gemini_model": "gemini-2.5-flash",
                "chunk_seconds": 90,
                "auto_ducking": True,
                "auto_speed_fit": True,
            }
            for k, v in defaults.items():
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                    (k, json.dumps(v)),
                )

    def add_api_key(self, provider: str, label: str, raw_key: str) -> str:
        key_id = f"key-{uuid.uuid4().hex[:10]}"
        enc = self.fernet.encrypt(raw_key.strip().encode("utf-8")).decode("utf-8")
        hint = mask_key(raw_key)
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO api_keys (id, provider, label, encrypted_key, key_hint, is_enabled, status, created_at)
                VALUES (?, ?, ?, ?, ?, 1, 'active', ?)
                """,
                (key_id, provider, label.strip() or f"{provider.upper()} Key", enc, hint, now),
            )
        return key_id

    def list_api_keys(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            if provider:
                rows = conn.execute(
                    "SELECT id, provider, label, key_hint, is_enabled, status, usage_count, error_count, last_error, cooldown_until, created_at FROM api_keys WHERE provider = ? ORDER BY created_at ASC",
                    (provider,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, provider, label, key_hint, is_enabled, status, usage_count, error_count, last_error, cooldown_until, created_at FROM api_keys ORDER BY provider, created_at ASC"
                ).fetchall()
            return [dict(r) for r in rows]

    def get_decrypted_key(self, key_id: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute("SELECT encrypted_key FROM api_keys WHERE id = ?", (key_id,)).fetchone()
            if not row:
                return None
            return self.fernet.decrypt(row["encrypted_key"].encode("utf-8")).decode("utf-8")

    def toggle_api_key(self, key_id: str, enabled: bool) -> None:
        status = "active" if enabled else "disabled"
        with self._connect() as conn:
            conn.execute(
                "UPDATE api_keys SET is_enabled = ?, status = ? WHERE id = ?",
                (1 if enabled else 0, status, key_id),
            )

    def delete_api_key(self, key_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM api_keys WHERE id = ?", (key_id,))

    def record_key_usage(self, key_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE api_keys SET usage_count = usage_count + 1, status = 'active', last_error = NULL, cooldown_until = NULL WHERE id = ?",
                (key_id,),
            )

    def record_key_error(self, key_id: str, status: str, message: str, cooldown_until: Optional[float]) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE api_keys SET error_count = error_count + 1, status = ?, last_error = ?, cooldown_until = ? WHERE id = ?",
                (status, message[:300], cooldown_until, key_id),
            )

    def create_project(self, name: str, video_path: str, duration_sec: float, width: int, height: int, fps: float) -> str:
        pid = f"proj-{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO projects (id, name, video_path, output_folder, duration_sec, width, height, fps, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, name, video_path, str(DEFAULT_EXPORT_DIR), duration_sec, width, height, fps, now, now),
            )
        return pid

    def update_project(self, project_id: str, **kwargs: Any) -> None:
        if not kwargs:
            return
        kwargs["updated_at"] = datetime.now(timezone.utc).isoformat()
        cols = ", ".join(f"{k} = ?" for k in kwargs.keys())
        vals = list(kwargs.values()) + [project_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE projects SET {cols} WHERE id = ?", vals)

    def list_projects(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
            return [dict(r) for r in rows]

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            return dict(row) if row else None

    def replace_segments(self, project_id: str, segments: List[Dict[str, Any]]) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM segments WHERE project_id = ?", (project_id,))
            for s in segments:
                conn.execute(
                    """
                    INSERT INTO segments (id, project_id, idx, start_time, end_time, speaker_id, source_text, khmer_text, emotion, acting_notes, voice_name, speech_speed, pitch_shift, tts_path, tts_duration)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        s.get("id") or f"seg-{uuid.uuid4().hex[:8]}",
                        project_id,
                        s["idx"],
                        s["start_time"],
                        s["end_time"],
                        s.get("speaker_id", "SPEAKER_01"),
                        s["source_text"],
                        s.get("khmer_text", ""),
                        s.get("emotion", "Calm"),
                        s.get("acting_notes", ""),
                        s.get("voice_name", "km-KH-SreymomNeural"),
                        s.get("speech_speed", 1.0),
                        s.get("pitch_shift", 0.0),
                        s.get("tts_path"),
                        s.get("tts_duration", 0.0),
                    ),
                )

    def list_segments(self, project_id: str) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM segments WHERE project_id = ? ORDER BY idx ASC", (project_id,)).fetchall()
            return [dict(r) for r in rows]

    def add_voice_profile(self, name: str, gender: str, sample_path: str, notes: str = "") -> str:
        vid = f"voice-{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO voice_profiles (id, name, gender, sample_path, consent_confirmed, notes, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
                (vid, name, gender, sample_path, notes, now),
            )
        return vid

    def list_voice_profiles(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM voice_profiles ORDER BY created_at DESC").fetchall()
            return [dict(r) for r in rows]
