from pathlib import Path
from typing import Any, Dict, List, Tuple
from groq import Groq
from app.key_manager import ApiKeyRotationManager


def transcribe_chunks_with_groq(
    rotation: ApiKeyRotationManager,
    chunks: List[Tuple[Path, float]],
    source_language: str = "auto",
) -> Tuple[List[Dict[str, Any]], str]:
    segments: List[Dict[str, Any]] = []
    detected_lang = source_language
    idx = 0

    for chunk_path, offset_sec in chunks:
        def _call(api_key: str):
            client = Groq(api_key=api_key)
            with open(chunk_path, "rb") as audio_file:
                kwargs: Dict[str, Any] = {
                    "file": (chunk_path.name, audio_file.read()),
                    "model": "whisper-large-v3-turbo",
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["segment"],
                }
                if source_language and source_language != "auto":
                    kwargs["language"] = source_language
                return client.audio.transcriptions.create(**kwargs)

        resp = rotation.execute_with_rotation("groq", _call)
        resp_dict = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
        if resp_dict.get("language"):
            detected_lang = str(resp_dict["language"])

        for seg in resp_dict.get("segments", []):
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            start_t = round(offset_sec + float(seg.get("start", 0.0)), 2)
            end_t = round(offset_sec + float(seg.get("end", 0.0)), 2)
            if end_t <= start_t:
                end_t = round(start_t + 0.5, 2)
            segments.append(
                {
                    "idx": idx,
                    "start_time": start_t,
                    "end_time": end_t,
                    "speaker_id": "SPEAKER_01",
                    "source_text": text,
                }
            )
            idx += 1

    return segments, detected_lang
