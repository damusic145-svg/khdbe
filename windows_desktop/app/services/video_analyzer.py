import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple
import pysrt


@dataclass
class VideoMetadata:
    duration_sec: float
    width: int
    height: int
    fps: float
    has_audio: bool
    has_subtitles: bool


def probe_video(video_path: Path) -> VideoMetadata:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]
    out = subprocess.check_output(cmd, text=True)
    data = json.loads(out)
    streams = data.get("streams", [])
    v_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    s_stream = next((s for s in streams if s.get("codec_type") == "subtitle"), None)

    fps_str = v_stream.get("avg_frame_rate") or v_stream.get("r_frame_rate") or "30/1"
    fps = 30.0
    if "/" in fps_str:
        n, d = fps_str.split("/", 1)
        if float(d) > 0:
            fps = round(float(n) / float(d), 2)

    dur = float(data.get("format", {}).get("duration") or v_stream.get("duration") or 0.0)
    return VideoMetadata(
        duration_sec=dur,
        width=int(v_stream.get("width") or 1920),
        height=int(v_stream.get("height") or 1080),
        fps=fps,
        has_audio=a_stream is not None,
        has_subtitles=s_stream is not None,
    )


def extract_embedded_subtitles(video_path: Path, out_srt: Path) -> List[Tuple[float, float, str]]:
    out_srt.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-map", "0:s:0", "-c:s", "srt", str(out_srt)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if out_srt.exists():
            subs = pysrt.open(str(out_srt), encoding="utf-8")
            cues = []
            for sub in subs:
                start = sub.start.ordinal / 1000.0
                end = sub.end.ordinal / 1000.0
                txt = sub.text.replace("\n", " ").strip()
                if txt and end > start:
                    cues.append((start, end, txt))
            return cues
    except Exception:
        pass
    return []


def extract_and_chunk_audio(video_path: Path, work_dir: Path, chunk_sec: int = 90) -> List[Tuple[Path, float]]:
    work_dir.mkdir(parents=True, exist_ok=True)
    wav_path = work_dir / "source_16k.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    meta = probe_video(wav_path)
    total = meta.duration_sec
    chunks: List[Tuple[Path, float]] = []
    offset = 0.0
    idx = 0
    while offset < total:
        dur = min(chunk_sec, total - offset)
        if dur < 0.4:
            break
        out_mp3 = work_dir / f"chunk_{idx:03d}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(offset), "-t", str(dur), "-i", str(wav_path), "-ac", "1", "-ar", "16000", "-b:a", "64k", str(out_mp3)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        chunks.append((out_mp3, offset))
        offset += chunk_sec
        idx += 1
    return chunks
