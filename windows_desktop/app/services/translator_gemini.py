import json
from typing import Any, Dict, List
from google import genai
from google.genai import types
from app.config import EMOTIONS
from app.key_manager import ApiKeyRotationManager


def translate_segments_to_khmer(
    rotation: ApiKeyRotationManager,
    segments: List[Dict[str, Any]],
    story_summary: str,
    model_name: str = "gemini-2.5-flash",
) -> List[Dict[str, Any]]:
    batch_size = 25
    translated_map: Dict[int, Dict[str, Any]] = {}
    prev_context = ""

    for i in range(0, len(segments), batch_size):
        batch = segments[i : i + batch_size]
        payload = [
            {
                "idx": s["idx"],
                "duration_sec": round(max(0.5, s["end_time"] - s["start_time"]), 2),
                "speaker": s.get("speaker_id", "SPEAKER_01"),
                "text": s["source_text"],
            }
            for s in batch
        ]
        prompt = (
            "You are an expert Khmer dubbing scriptwriter. Translate every line into natural spoken Khmer (ភាសាខ្មែរ), "
            "preserving character names, relationships, story continuity, and proportional spoken duration. "
            f"Classify emotion from: {', '.join(EMOTIONS)}.\n"
            f"Story context: {story_summary}\n"
            f"Previous lines:\n{prev_context}\n\n"
            "Return JSON: {\"translations\": [{\"idx\": int, \"khmer_text\": str, \"emotion\": str, \"acting_notes\": str}]}\n"
            f"Input:\n{json.dumps(payload, ensure_ascii=False)}"
        )

        def _call(api_key: str):
            client = genai.Client(api_key=api_key)
            resp = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            return json.loads(resp.text or "{}")

        data = rotation.execute_with_rotation("gemini", _call)
        for item in data.get("translations", []):
            idx = int(item["idx"])
            emo = item.get("emotion", "Calm")
            if emo not in EMOTIONS:
                emo = "Calm"
            translated_map[idx] = {
                "khmer_text": str(item.get("khmer_text", "")).strip(),
                "emotion": emo,
                "acting_notes": str(item.get("acting_notes", "")).strip(),
            }

        prev_context = "\n".join(
            f"[{b['speaker_id']}] {b['source_text']} -> {translated_map.get(b['idx'], {}).get('khmer_text', '')}"
            for b in batch[-4:]
        )

    for seg in segments:
        tr = translated_map.get(seg["idx"])
        if tr:
            seg["khmer_text"] = tr["khmer_text"]
            seg["emotion"] = tr["emotion"]
            seg["acting_notes"] = tr["acting_notes"]

    return segments
