import shutil
from pathlib import Path
from app.config import VOICES_DIR
from app.database import LocalDatabase


def register_authorized_voice_sample(
    db: LocalDatabase,
    name: str,
    gender: str,
    source_sample_path: Path,
    notes: str = "",
) -> str:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    dest = VOICES_DIR / f"{name.replace(' ', '_').lower()}_{source_sample_path.name}"
    shutil.copy2(source_sample_path, dest)
    return db.add_voice_profile(name=name, gender=gender, sample_path=str(dest), notes=notes)
