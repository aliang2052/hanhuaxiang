#!/usr/bin/env python3
"""Render 63 deterministic loops from compact VCSL CC0 live recordings."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "assets" / "audio-source" / "vcsl"
SOURCE_MANIFEST = SOURCE_ROOT / "manifest.json"
SR = 44_100
DURATION = 16.0
SAMPLES = int(SR * DURATION)


def _decode(path: Path) -> np.ndarray:
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
            "-ac", "1", "-ar", str(SR), "-f", "f32le", "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    signal = np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)
    if not signal.size:
        raise RuntimeError(f"decoded recording is empty: {path}")
    signal[~np.isfinite(signal)] = 0
    signal -= float(np.mean(signal))
    peak = float(np.max(np.abs(signal))) or 1
    threshold = max(.00035, peak * .008)
    active = np.flatnonzero(np.abs(signal) >= threshold)
    if active.size:
        start = max(0, int(active[0]) - int(.012 * SR))
        signal = signal[start:]
    peak = float(np.max(np.abs(signal))) or 1
    return signal / peak * .82


def _event_times(role: str, index: int, rng: np.random.Generator) -> list[float]:
    phase = .08 + (index % 5) * .035
    if role == "pluck":
        patterns = ((0, .72, 1.55, 2.58, 3.32), (0, 1.02, 1.7, 2.82), (0, .52, 1.88, 2.42, 3.45))
        pattern = patterns[index % len(patterns)]
        return [bar + beat + phase + float(rng.uniform(-.018, .018)) for bar in (0, 4, 8, 12) for beat in pattern]
    if role == "sustain":
        return [beat + phase + float(rng.uniform(-.028, .028)) for beat in (0, 4.05, 8.08, 12.1)]
    if role == "wind":
        patterns = ((0, 3.2, 6.7, 10.1, 13.25), (0, 3.75, 7.15, 10.65, 13.5))
        return [beat + phase + float(rng.uniform(-.035, .035)) for beat in patterns[index % 2]]
    if role == "strike":
        patterns = ((0, 2.0, 4.65, 7.4, 9.5, 12.25, 14.2), (0, 2.7, 4.15, 6.9, 9.35, 11.1, 13.8))
        return [beat + phase + float(rng.uniform(-.025, .025)) for beat in patterns[index % 2]]
    if role == "clapper":
        return [beat + phase + float(rng.uniform(-.015, .015)) for beat in np.arange(0, 15.35, .67)]
    if role == "drum":
        patterns = ((0, 1.32, 2.65, 3.3), (0, .68, 2.0, 3.35), (0, 1.0, 2.7))
        pattern = patterns[index % len(patterns)]
        return [bar + beat + phase + float(rng.uniform(-.02, .02)) for bar in (0, 4, 8, 12) for beat in pattern]
    patterns = ((0, .82, 1.65, 2.5, 3.38), (0, 1.28, 2.02, 3.18), (0, .55, 1.75, 2.82))
    pattern = patterns[index % len(patterns)]
    return [bar + beat + phase + float(rng.uniform(-.022, .022)) for bar in (0, 4, 8, 12) for beat in pattern]


def _max_sample_seconds(role: str) -> float:
    return {
        "pluck": 2.4,
        "sustain": 3.6,
        "wind": 3.05,
        "strike": 2.55,
        "clapper": .72,
        "drum": 1.85,
        "movement": 1.35,
    }[role]


def _mix_voice(samples: list[np.ndarray], role: str, index: int) -> np.ndarray:
    rng = np.random.default_rng(20260802 + index * 7919)
    output = np.zeros(SAMPLES, dtype=np.float64)
    max_length = int(_max_sample_seconds(role) * SR)
    for event_index, event_time in enumerate(_event_times(role, index, rng)):
        source = samples[(event_index + index) % len(samples)]
        source = source[:max_length].copy()
        if source.size > int(.06 * SR):
            fade = min(source.size // 5, int((.055 if role not in {"sustain", "wind"} else .12) * SR))
            if fade:
                source[-fade:] *= np.linspace(1, 0, fade, endpoint=True)
        velocity = .62 + .30 * float(rng.random())
        if event_index % (5 if role in {"pluck", "movement"} else 4) == 0:
            velocity = min(1, velocity + .12)
        start = max(0, int(event_time * SR))
        end = min(SAMPLES, start + source.size)
        if end > start:
            output[start:end] += source[:end - start] * velocity

    # Calibrate very different source-recording levels without flattening their
    # crest factors. Sparse percussion may hit the peak guard before RMS target;
    # sustained instruments reach the target with their natural envelope intact.
    target_rms = {
        "pluck": .070,
        "sustain": .095,
        "wind": .090,
        "strike": .058,
        "clapper": .050,
        "drum": .066,
        "movement": .050,
    }[role]
    rms = float(np.sqrt(np.mean(output * output))) or 1
    peak = float(np.max(np.abs(output))) or 1
    output *= min(target_rms / rms, .88 / peak)
    fade = int(.035 * SR)
    output[:fade] *= np.linspace(0, 1, fade, endpoint=False)
    output[-fade:] *= np.linspace(1, 0, fade, endpoint=True)
    return output


def _write_ogg(signal: np.ndarray, destination: Path, serial: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="han-live-audio-") as temp_dir:
        wav_path = Path(temp_dir) / "render.wav"
        pcm = np.int16(np.clip(signal, -1, 1) * 32767)
        with wave.open(str(wav_path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SR)
            wav.writeframes(pcm.tobytes())
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-fflags", "+bitexact", "-i", str(wav_path),
                "-map_metadata", "-1", "-flags:a", "+bitexact", "-c:a", "libopus",
                "-b:a", "80k", "-vbr", "off", "-application", "audio", "-frame_duration", "20",
                "-serial_offset", str(serial), str(destination),
            ],
            check=True,
        )


def build_live_audio(output_dir: Path) -> dict[str, object]:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to rebuild the CC0 live audio loops")
    if not SOURCE_MANIFEST.is_file():
        raise RuntimeError(f"missing live audio source manifest: {SOURCE_MANIFEST}")
    manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    voices = manifest.get("voices", [])
    if len(voices) != 63:
        raise RuntimeError(f"live audio manifest must contain 63 voices, got {len(voices)}")
    for stale in output_dir.glob("*"):
        if stale.is_file() and stale.suffix.lower() in {".wav", ".ogg", ".m4a", ".mp3"}:
            stale.unlink()

    outputs = []
    for index, voice in enumerate(voices):
        decoded = []
        for sample in voice["samples"]:
            source = SOURCE_ROOT / sample["file"]
            if not source.is_file():
                raise RuntimeError(f"missing imported VCSL recording: {source}")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            if digest != sample["sha256"]:
                raise RuntimeError(f"source checksum mismatch: {source}")
            decoded.append(_decode(source))
        signal = _mix_voice(decoded, str(voice["role"]), index)
        destination = output_dir / f"{voice['id']}.ogg"
        _write_ogg(signal, destination, index + 1001)
        outputs.append({"id": voice["id"], "file": destination.name, "bytes": destination.stat().st_size})
    return {
        "voiceCount": len(outputs),
        "recordingCount": sum(len(voice["samples"]) for voice in voices),
        "durationSeconds": DURATION,
        "sampleRate": SR,
        "codec": "Opus in Ogg, 80 kbps CBR",
        "outputs": outputs,
    }
