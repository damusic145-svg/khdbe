import json
from typing import Any, Dict, List
from google import genai
from google.genai import types
from app.key_manager import ApiKeyRotationManager


def diarize_and_assign_speakers(
    rotation: ApiKeyRotationManager,
    segments: List[Dict[str, Any]],
    model_name: str = "gemini-2.5-flash",
) -> Dict[str, Any]:
    compact = [
        {"idx": s["idx"], "t": f"{s['start_time']:.2f}-{s['end_time']:.2f}", "text": s["source_text"]}
        for s in segments
    ]

    prompt = (
        "Identify every distinct speaker across this video dialogue transcript. "
        "Return JSON with story_summary, speakers ([{speaker_id, display_name, gender, recommended_voice}]), "
        "and assignments ([{idx, speaker_id}]). Use km-KH-PisethNeural for male speakers and km-KH-SreymomNeural for female speakers.\n\n"
        f"{json.dumps(compact, ensure_ascii=False)}"
    )

    def _call(api_key: str):
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return json.loads(resp.text or "{}")

    return rotation.execute_with_rotation("gemini", _call)
