#!/usr/bin/env python3
"""Regenerate optimized sprites, the 63-cell config, and synchronized WAV loops.

Runtime does not need Python. This script is included so the delivered visual and
sound assets can be rebuilt from assets/source-highres without hidden tooling.
"""
from __future__ import annotations

import json
import math
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "source-highres"
SPRITES = ASSETS / "sprites"
AUDIO = ASSETS / "audio"
CONFIG = ROOT / "config"
for directory in (SPRITES, AUDIO, CONFIG):
    directory.mkdir(parents=True, exist_ok=True)

SPRITE_NAMES = ["qin", "flute", "pipa", "bells", "erhu", "drum", "dancer", "attendant"]
LABELS = {"qin": "琴", "flute": "笛", "pipa": "琵琶", "bells": "钟磬", "erhu": "弦乐", "drum": "鼓", "dancer": "舞", "attendant": "侍"}
COLORS = ["#879c74", "#93826c", "#756f8f", "#9a725e", "#657d83", "#8d6d43", "#7f6d86", "#6f816d"]
SR = 22_050
DURATION = 16.0
N = int(SR * DURATION)
RNG = np.random.default_rng(20260731)


def build_visuals() -> None:
    mural = Image.open(SOURCE / "base-mural.png").convert("RGB")
    w, h = mural.size
    ratio = 16 / 9
    if w / h > ratio:
        new_w = int(h * ratio)
        left = (w - new_w) // 2
        mural = mural.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / ratio)
        top = (h - new_h) // 2
        mural = mural.crop((0, top, w, top + new_h))
    mural = mural.resize((1920, 1080), Image.Resampling.LANCZOS)
    mural = ImageEnhance.Contrast(mural).enhance(0.92)
    mural = ImageEnhance.Brightness(mural).enhance(1.06)
    mural.save(ASSETS / "mural-base.jpg", quality=92, optimize=True, progressive=True)

    manifest: dict[str, dict[str, float | int | str]] = {}
    for name in SPRITE_NAMES:
        image = Image.open(SOURCE / f"{name}.png").convert("RGBA")
        bbox = image.getchannel("A").getbbox()
        if bbox:
            image = image.crop(bbox)
        pad = max(12, int(max(image.size) * 0.045))
        canvas = Image.new("RGBA", (image.width + pad * 2, image.height + pad * 2), (0, 0, 0, 0))
        canvas.alpha_composite(image, (pad, pad))
        image = canvas
        scale = min(1.0, 900 / max(image.size))
        if scale < 1:
            image = image.resize((int(image.width * scale), int(image.height * scale)), Image.Resampling.LANCZOS)
        image.save(SPRITES / f"{name}.png", optimize=True)
        manifest[name] = {
            "file": f"assets/sprites/{name}.png",
            "width": image.width,
            "height": image.height,
            "aspect": image.width / image.height,
        }
    (SPRITES / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def adsr(length: float, attack: float = 0.01, decay: float = 0.08, sustain: float = 0.5, release: float = 0.25) -> np.ndarray:
    n = max(1, int(length * SR))
    env = np.ones(n) * sustain
    a = min(n, int(attack * SR))
    d = min(max(0, n - a), int(decay * SR))
    r = min(n, int(release * SR))
    if a:
        env[:a] = np.linspace(0, 1, a, endpoint=False)
    if d:
        env[a : a + d] = np.linspace(1, sustain, d, endpoint=False)
    if r:
        env[-r:] *= np.linspace(1, 0, r)
    return env


def add_tone(buffer: np.ndarray, start: float, duration: float, frequency: float, amplitude: float = 0.2,
             harmonics: tuple[float, ...] = (1.0,), vibrato: float = 0, noise: float = 0, pluck: bool = False) -> None:
    i0 = int(start * SR)
    n = min(int(duration * SR), N - i0)
    if n <= 0:
        return
    t = np.arange(n) / SR
    phase = 2 * np.pi * frequency * t
    if vibrato:
        phase = 2 * np.pi * frequency * (t + (vibrato / (2 * np.pi * 5)) * np.sin(2 * np.pi * 5 * t))
    signal = np.zeros(n)
    for harmonic, gain in enumerate(harmonics, 1):
        signal += gain * np.sin(harmonic * phase)
    if pluck:
        envelope = np.exp(-t * (3.2 + frequency / 600))
        signal *= envelope
        signal += 0.12 * RNG.standard_normal(n) * np.exp(-t * 28)
    else:
        envelope = adsr(duration, 0.06, 0.18, 0.72, 0.35)[:n]
        signal *= envelope
    if noise:
        signal += noise * RNG.standard_normal(n) * envelope
    buffer[i0 : i0 + n] += amplitude * signal


def add_bell(buffer: np.ndarray, start: float, frequency: float, amplitude: float = 0.28, duration: float = 2.5) -> None:
    i0 = int(start * SR)
    n = min(int(duration * SR), N - i0)
    t = np.arange(n) / SR
    ratios = (1, 2.71, 4.05, 5.43)
    gains = (1, 0.45, 0.24, 0.13)
    signal = sum(g * np.sin(2 * np.pi * frequency * r * t) for g, r in zip(gains, ratios))
    signal *= np.exp(-t * 2.15)
    signal += 0.03 * RNG.standard_normal(n) * np.exp(-t * 18)
    buffer[i0 : i0 + n] += amplitude * signal


def add_drum(buffer: np.ndarray, start: float, amplitude: float = 0.65, kind: str = "low") -> None:
    duration = 0.55 if kind == "low" else 0.18
    i0 = int(start * SR)
    n = min(int(duration * SR), N - i0)
    t = np.arange(n) / SR
    if kind == "low":
        frequency = 90 * np.exp(-t * 4) + 42
        phase = 2 * np.pi * np.cumsum(frequency) / SR
        signal = np.sin(phase) * np.exp(-t * 7) + 0.14 * RNG.standard_normal(n) * np.exp(-t * 18)
    else:
        signal = RNG.standard_normal(n) * np.exp(-t * 28)
        signal += 0.25 * np.sin(2 * np.pi * 900 * t) * np.exp(-t * 35)
    buffer[i0 : i0 + n] += amplitude * signal


def write_wav(name: str, buffer: np.ndarray, gain: float = 0.92) -> None:
    fade = int(0.04 * SR)
    buffer[:fade] *= np.linspace(0, 1, fade)
    buffer[-fade:] *= np.linspace(1, 0, fade)
    buffer = np.tanh(buffer * 1.15)
    peak = float(np.max(np.abs(buffer))) or 1.0
    pcm = np.int16(np.clip(buffer / peak * gain, -1, 1) * 32767)
    with wave.open(str(AUDIO / f"{name}.wav"), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())


def build_audio() -> None:
    t = np.arange(N) / SR
    pentatonic = [220.0, 246.94, 293.66, 329.63, 392.0]

    buffer = sum(a * np.sin(2 * np.pi * f * t + RNG.random() * 2 * np.pi) for f, a in [(55, 0.07), (82.5, 0.045), (110, 0.03)])
    smooth = np.convolve(RNG.standard_normal(N), np.ones(500) / 500, mode="same")
    write_wav("ambience", buffer + 0.09 * smooth, 0.55)

    buffer = np.zeros(N)
    for i, note in enumerate([0, 2, 4, 1, 3, 4, 2, 0]):
        add_tone(buffer, i * 2, 1.7, pentatonic[note], 0.34, (1, 0.42, 0.17, 0.08), pluck=True)
    write_wav("qin", buffer)

    buffer = np.zeros(N)
    melody = [0, 1, 2, 4, 3, 2, 1, 0, 2, 3, 4, 2, 1, 0]
    for start, note in zip(np.linspace(0.15, 15.1, len(melody)), melody):
        add_tone(buffer, float(start), 0.88, pentatonic[note] * 2, 0.19, (1, 0.24, 0.08), vibrato=0.0025, noise=0.015)
    write_wav("flute", buffer)

    buffer = np.zeros(N)
    for bar in range(8):
        chord = [pentatonic[bar % 5], pentatonic[(bar + 2) % 5], pentatonic[(bar + 4) % 5]]
        for j in range(6):
            add_tone(buffer, bar * 2 + j * 0.285, 0.55, chord[j % 3] * 2, 0.18, (1, 0.55, 0.22), pluck=True)
    write_wav("pipa", buffer)

    buffer = np.zeros(N)
    for start, note in [(0, 0), (2, 2), (4, 4), (6, 1), (8, 3), (10, 4), (12, 2), (14, 0)]:
        add_bell(buffer, start + 0.02, pentatonic[note] * 1.5, 0.29, 1.9)
    write_wav("bells", buffer)

    buffer = np.zeros(N)
    for i, note in enumerate([0, 2, 3, 4, 3, 2, 1, 0]):
        start = i * 2
        n = int(1.8 * SR)
        local_t = np.arange(n) / SR
        phase = 2 * np.pi * pentatonic[note] * local_t + 0.7 * np.sin(2 * np.pi * 5.2 * local_t)
        signal = np.sin(phase) + 0.32 * np.sin(2 * phase) + 0.13 * np.sin(3 * phase)
        signal *= adsr(1.8, 0.18, 0.2, 0.75, 0.45)
        signal += 0.012 * RNG.standard_normal(n)
        buffer[int(start * SR) : int(start * SR) + n] += 0.20 * signal
    write_wav("erhu", buffer)

    buffer = np.zeros(N)
    for beat in np.arange(0, 16, 0.5):
        add_drum(buffer, float(beat), 0.65 if abs(beat % 2) < 1e-6 else 0.12, "low" if abs(beat % 2) < 1e-6 else "high")
    for start in [3.5, 7.5, 11.5, 15.5]:
        add_drum(buffer, start, 0.42, "low")
    write_wav("drum", buffer)

    buffer = np.zeros(N)
    for start in np.arange(0.25, 16, 0.5):
        add_drum(buffer, float(start), 0.18 if int(start * 2) % 4 else 0.28, "high")
    for start, note in [(1, 4), (5, 3), (9, 2), (13, 4)]:
        add_bell(buffer, start, pentatonic[note] * 3, 0.11, 1.2)
    write_wav("dancer", buffer)

    buffer = np.zeros(N)
    for start, note in [(0, 0), (4, 2), (8, 1), (12, 3)]:
        add_bell(buffer, start + 0.1, pentatonic[note], 0.16, 3.5)
        add_tone(buffer, start, 3.4, pentatonic[note] / 2, 0.08, (1, 0.18), vibrato=0.001)
    write_wav("attendant", buffer, 0.75)


def build_cells() -> None:
    cells = []
    for row in range(7):
        for col in range(9):
            index = row * 9 + col
            kind = SPRITE_NAMES[(index * 3 + row) % len(SPRITE_NAMES)]
            cells.append({
                "id": index,
                "row": row,
                "col": col,
                "type": kind,
                "label": LABELS[kind],
                "audio": f"assets/audio/{kind}.wav",
                "sprite": f"assets/sprites/{kind}.png",
                "color": COLORS[SPRITE_NAMES.index(kind)],
                "scale": round(0.70 + ((index * 37) % 13) / 100, 2),
                "xOffset": round(((index * 11) % 7 - 3) / 100, 2),
                "yOffset": round(((index * 19) % 9 - 4) / 100, 2),
                "mirror": (index + row) % 4 == 0,
                "phase": round(((index * 0.61803398875) % 1) * math.pi * 2, 4),
            })
    (CONFIG / "cells.json").write_text(json.dumps(cells, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    build_visuals()
    build_audio()
    build_cells()
    print("Regenerated mural, 8 sprites, 9 audio loops, and 63-cell config.")


if __name__ == "__main__":
    main()
