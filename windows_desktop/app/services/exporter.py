import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


def _fmt_srt(sec: float) -> str:
    hh = int(sec // 3600)
    mm = int((sec % 3600) // 60)
    ss = int(sec % 60)
    ms = int((sec - int(sec)) * 1000)
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"


def write_khmer_srt(segments: List[Dict[str, Any]], out_srt: Path) -> Path:
    out_srt.parent.mkdir(parents=True, exist_ok=True)
    blocks = []
    for i, s in enumerate(segments, start=1):
        txt = (s.get("khmer_text") or s.get("source_text") or "").strip()
        blocks.append(f"{i}\n{_fmt_srt(float(s['start_time']))} --> {_fmt_srt(float(s['end_time']))}\n{txt}\n")
    out_srt.write_text("\n".join(blocks), encoding="utf-8")
    return out_srt


def export_mp4_video(
    video_path: Path,
    mixed_audio_path: Path,
    output_mp4: Path,
    duration_sec: float,
    resolution: str = "1080p",
    codec: str = "h264",
    on_progress: Optional[Callable[[int], None]] = None,
) -> Path:
    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    scale = {
        "720p": "scale=-2:720",
        "1080p": "scale=-2:1080",
        "4k": "scale=-2:2160",
    }.get(resolution, "scale=trunc(iw/2)*2:trunc(ih/2)*2")
    vcodec = "libx265" if codec == "h265" else "libx264"

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-i",
        str(mixed_audio_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        scale,
        "-c:v",
        vcodec,
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        "-movflags",
        "+faststart",
        "-shortest",
        "-progress",
        "pipe:1",
        str(output_mp4),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.stdout:
        for line in proc.stdout:
            if line.startswith("out_time_ms=") and duration_sec > 0 and on_progress:
                out_sec = int(line.split("=", 1)[1].strip()) / 1_000_000.0
                pct = max(1, min(99, int((out_sec / duration_sec) * 100)))
                on_progress(pct)
    rc = proc.wait()
    if rc != 0:
        err = proc.stderr.read() if proc.stderr else ""
        raise RuntimeError(f"FFmpeg export error ({rc}): {err[-400:]}")
    if on_progress:
        on_progress(100)
    return output_mp4
