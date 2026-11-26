import subprocess
from pathlib import Path
from typing import Any, Dict, List
from app.services.video_analyzer import probe_video


def _atempo_chain(speed: float) -> str:
    parts = []
    rem = max(0.5, min(2.4, speed))
    while rem > 2.0:
        parts.append("atempo=2.0")
        rem /= 2.0
    while rem < 0.5:
        parts.append("atempo=0.5")
        rem /= 0.5
    if abs(rem - 1.0) > 0.01:
        parts.append(f"atempo={rem:.4f}")
    return ",".join(parts) if parts else "anull"


def fit_and_mix_audio(
    video_path: Path,
    segments: List[Dict[str, Any]],
    work_dir: Path,
    bgm_volume: float = 0.35,
    dub_volume: float = 1.0,
    voice_reduction: str = "soft",
) -> Path:
    fit_dir = work_dir / "tts_fit"
    fit_dir.mkdir(parents=True, exist_ok=True)
    ready_clips: List[Dict[str, Any]] = []

    for i, seg in enumerate(segments):
        tts_path = seg.get("tts_path")
        if not tts_path or not Path(tts_path).exists():
            continue
        raw_meta = probe_video(Path(tts_path))
        own_win = max(0.6, float(seg["end_time"]) - float(seg["start_time"]))
        next_start = float(segments[i + 1]["start_time"]) if i + 1 < len(segments) else float(seg["start_time"]) + own_win + 1.5
        max_win = max(own_win, next_start - float(seg["start_time"]) - 0.05)

        speed = float(seg.get("speech_speed", 1.0))
        if raw_meta.duration_sec / speed > max_win:
            speed = min(1.35, raw_meta.duration_sec / max_win)

        fit_wav = fit_dir / f"seg_{i:04d}.wav"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(tts_path),
                "-af",
                f"{_atempo_chain(speed)},loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ac",
                "2",
                "-ar",
                "44100",
                "-c:a",
                "pcm_s16le",
                str(fit_wav),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        fit_meta = probe_video(fit_wav)
        ready_clips.append(
            {
                "path": fit_wav,
                "start_time": float(seg["start_time"]),
                "duration": fit_meta.duration_sec,
            }
        )

    mixed_wav = work_dir / "mixed_dub.wav"
    cmd = ["ffmpeg", "-y", "-i", str(video_path)]
    for c in ready_clips:
        cmd.extend(["-i", str(c["path"])])

    bgm_chain = "[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"
    if voice_reduction == "soft":
        bgm_chain += ",stereotools=mlev=0.45:slev=1.05"
    elif voice_reduction == "aggressive":
        bgm_chain += ",stereotools=mlev=0.18:slev=1.15"
    bgm_chain += f",volume={bgm_volume:.2f},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[bgm_raw]"

    filters = [bgm_chain]
    dub_labels = []
    last_end_ms = 0
    for idx, c in enumerate(ready_clips):
        start_ms = max(int(c["start_time"] * 1000), last_end_ms)
        last_end_ms = start_ms + int(c["duration"] * 1000) + 30
        lbl = f"dub{idx}"
        filters.append(f"[{idx + 1}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay={start_ms}|{start_ms}[{lbl}]")
        dub_labels.append(f"[{lbl}]")

    if len(dub_labels) == 1:
        filters.append(f"{dub_labels[0]}volume={dub_volume:.2f},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[dub_bus]")
    else:
        filters.append(f"{''.join(dub_labels)}amix=inputs={len(dub_labels)}:duration=longest:normalize=0,volume={dub_volume:.2f},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[dub_bus]")

    filters.extend(
        [
            "[dub_bus]asplit=2[dub_sc][dub_mix]",
            "[bgm_raw][dub_sc]sidechaincompress=threshold=0.025:ratio=3.5:attack=25:release=250,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[bgm_ducked]",
            "[bgm_ducked][dub_mix]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
        ]
    )

    cmd.extend(["-filter_complex", ";".join(filters), "-map", "[aout]", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(mixed_wav)])
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return mixed_wav
