import asyncio
from pathlib import Path
import edge_tts

EMOTION_PROSODY = {
    "Happy": ("+8%", "+4Hz"),
    "Sad": ("-10%", "-3Hz"),
    "Angry": ("+10%", "+2Hz"),
    "Excited": ("+14%", "+6Hz"),
    "Romantic": ("-8%", "-2Hz"),
    "Scared": ("+12%", "+5Hz"),
    "Serious": ("-5%", "-4Hz"),
    "Calm": ("+0%", "+0Hz"),
    "Whispering": ("-12%", "-2Hz"),
    "Crying": ("-14%", "+3Hz"),
    "Shouting": ("+15%", "+8Hz"),
    "Surprised": ("+10%", "+7Hz"),
}


async def _synthesize_async(text: str, voice_name: str, emotion: str, rate_override: float, pitch_offset: float, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    base_rate, base_pitch = EMOTION_PROSODY.get(emotion, ("+0%", "+0Hz"))
    rate_pct = int(base_rate.replace("%", "")) + int((rate_override - 1.0) * 100)
    pitch_hz = int(base_pitch.replace("Hz", "")) + int(pitch_offset * 4)
    rate_str = f"{rate_pct:+d}%"
    pitch_str = f"{pitch_hz:+d}Hz"
    communicate = edge_tts.Communicate(text=text, voice=voice_name, rate=rate_str, pitch=pitch_str)
    await communicate.save(str(out_path))


def synthesize_khmer_line(
    text: str,
    voice_name: str,
    emotion: str,
    out_path: Path,
    rate_override: float = 1.0,
    pitch_offset: float = 0.0,
) -> Path:
    asyncio.run(_synthesize_async(text, voice_name, emotion, rate_override, pitch_offset, out_path))
    return out_path
