#!/usr/bin/env python3
"""Rebuild project-owned visual/audio outputs without online dependencies.

The immutable inputs are:
- assets/source-highres/base-mural.png
- eight independently generated transparent character PNGs in assets/source-highres/

Twenty-four additional *distinct* base silhouettes/groups are deterministically
extracted from the project-owned mural by crop recipes. Runtime sprites are then
built from 32 base silhouettes. Use --output-root to build into a temporary tree;
this is what the non-destructive cross-platform verifier does.
"""
from __future__ import annotations

import argparse
import json
import math
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
INPUT_SOURCE = ROOT / "assets" / "source-highres"

INDEPENDENT_TYPES = ["qin", "flute", "pipa", "bells", "erhu", "drum", "dancer", "attendant"]
TYPE_META = {
    "qin": {"label": "琴", "audio": "qin", "animation": "pluck", "color": "#c49a3a"},
    "flute": {"label": "横笛", "audio": "dizi", "animation": "flute", "color": "#3f8779"},
    "pipa": {"label": "琵琶", "audio": "pipa", "animation": "pluck", "color": "#b84b35"},
    "bells": {"label": "编钟", "audio": "bronze-bells", "animation": "strike", "color": "#d0a13b"},
    "erhu": {"label": "弓弦", "audio": "bowed-string", "animation": "bow", "color": "#426f89"},
    "drum": {"label": "鼍鼓", "audio": "war-drum", "animation": "drum", "color": "#c7472d"},
    "dancer": {"label": "袖舞", "audio": "sleeve-dance", "animation": "dance", "color": "#8c4f99"},
    "attendant": {"label": "仪礼", "audio": "processional", "animation": "serve", "color": "#66874f"},
    "sheng": {"label": "笙", "audio": "sheng", "animation": "reed", "color": "#78913f"},
    "panpipe": {"label": "排箫", "audio": "panpipe", "animation": "panpipe", "color": "#4d8c83"},
    "se": {"label": "瑟", "audio": "se", "animation": "harp", "color": "#aa7b2f"},
    "clapper": {"label": "拍板", "audio": "clapper", "animation": "clapper", "color": "#b26731"},
    "cymbal": {"label": "铙钹", "audio": "cymbal", "animation": "cymbal", "color": "#d2a33e"},
    "acrobat": {"label": "百戏", "audio": "rattle", "animation": "acrobat", "color": "#a74369"},
    "procession": {"label": "仪仗", "audio": "frame-drum", "animation": "procession", "color": "#6c8c45"},
    "banquet": {"label": "石磬", "audio": "stone-chime", "animation": "banquet", "color": "#537e85"},
    "gong": {"label": "建鼓", "audio": "grand-drum", "animation": "gong", "color": "#c35a28"},
    "horn": {"label": "角", "audio": "horn", "animation": "horn", "color": "#9c6a35"},
}

VOICE_AUDIO_META = [
    ("qin", "琴", .14, .20),
    ("dizi", "横笛", .12, .24),
    ("pipa", "琵琶", .13, .18),
    ("bronze-bells", "编钟", .11, .34),
    ("bowed-string", "弓弦", .11, .30),
    ("war-drum", "鼍鼓", .12, .25),
    ("sleeve-dance", "袖舞", .10, .28),
    ("processional", "仪礼", .09, .38),
    ("sheng", "笙", .10, .34),
    ("panpipe", "排箫", .10, .30),
    ("se", "瑟", .13, .22),
    ("clapper", "拍板", .10, .20),
    ("cymbal", "铙钹", .09, .42),
    ("rattle", "节铃", .09, .25),
    ("frame-drum", "扁鼓", .11, .25),
    ("stone-chime", "石磬", .11, .36),
    ("grand-drum", "建鼓", .13, .32),
    ("horn", "角", .10, .36),
]

# Coordinates are in the 1672×941 project-owned mural. They deliberately select
# different poses, instruments, objects and groups; none is a mirror-only variant.
MURAL_CROP_RECIPES = [
    {"id": "mural-qin-platform", "kind": "se", "box": [18, 236, 292, 535]},
    {"id": "mural-standing-reed", "kind": "sheng", "box": [258, 205, 471, 535]},
    {"id": "mural-pipa-seated", "kind": "pipa", "box": [488, 235, 716, 526]},
    {"id": "mural-bell-rack-ensemble", "kind": "bells", "box": [650, 205, 1034, 535]},
    {"id": "mural-bell-striker", "kind": "bells", "box": [754, 261, 960, 529]},
    {"id": "mural-bowed-string", "kind": "erhu", "box": [968, 226, 1193, 529]},
    {"id": "mural-panpipe-seated", "kind": "panpipe", "box": [1206, 236, 1410, 529]},
    {"id": "mural-grand-drum-duo", "kind": "gong", "box": [1372, 201, 1665, 541]},
    {"id": "mural-drum-player", "kind": "drum", "box": [1490, 228, 1668, 535]},
    {"id": "mural-left-attendant", "kind": "clapper", "box": [0, 523, 145, 813]},
    {"id": "mural-ribbon-duo-left", "kind": "dancer", "box": [104, 498, 350, 812]},
    {"id": "mural-cymbal-dancer", "kind": "cymbal", "box": [290, 500, 505, 808]},
    {"id": "mural-tray-procession", "kind": "procession", "box": [428, 492, 606, 812]},
    {"id": "mural-cup-kneeler-left", "kind": "banquet", "box": [548, 540, 735, 811]},
    {"id": "mural-banquet-table", "kind": "banquet", "box": [626, 486, 1092, 823]},
    {"id": "mural-banquet-duo", "kind": "banquet", "box": [698, 520, 960, 811]},
    {"id": "mural-cup-kneeler-right", "kind": "banquet", "box": [945, 520, 1135, 811]},
    {"id": "mural-standing-server", "kind": "attendant", "box": [1046, 478, 1206, 818]},
    {"id": "mural-acrobat-ribbon", "kind": "acrobat", "box": [1110, 497, 1329, 814]},
    {"id": "mural-sleeve-dancer", "kind": "dancer", "box": [1248, 486, 1492, 817]},
    {"id": "mural-right-procession", "kind": "procession", "box": [1444, 491, 1672, 820]},
    {"id": "mural-horn-standing", "kind": "horn", "box": [250, 210, 455, 515]},
    {"id": "mural-ritual-trio", "kind": "procession", "box": [414, 491, 732, 824]},
    {"id": "mural-dance-banquet-group", "kind": "dancer", "box": [1080, 470, 1510, 832]},
]

SR = 44_100
DURATION = 32.0
N = int(SR * DURATION)
RNG = np.random.default_rng(20260731)


@dataclass(frozen=True)
class BuildPaths:
    root: Path
    assets: Path
    source_crops: Path
    background: Path
    sprites: Path
    audio: Path
    config: Path
    docs: Path


def paths_for(output_root: Path) -> BuildPaths:
    output_root = output_root.resolve()
    paths = BuildPaths(
        root=output_root,
        assets=output_root / "assets",
        source_crops=output_root / "assets" / "source-highres" / "mural-crops",
        background=output_root / "assets" / "background",
        sprites=output_root / "assets" / "sprites" / "variants",
        audio=output_root / "assets" / "audio",
        config=output_root / "config",
        docs=output_root / "docs" / "screenshots",
    )
    for directory in (paths.source_crops, paths.background, paths.sprites, paths.audio, paths.config, paths.docs):
        directory.mkdir(parents=True, exist_ok=True)
    return paths


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", compress_level=6, optimize=False)


def validate_inputs() -> None:
    required = [INPUT_SOURCE / "base-mural.png", *[INPUT_SOURCE / f"{name}.png" for name in INDEPENDENT_TYPES]]
    missing = [path.relative_to(ROOT).as_posix() for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Missing immutable source assets:\n- " + "\n- ".join(missing))
    mural = Image.open(INPUT_SOURCE / "base-mural.png")
    if mural.width < 1600 or mural.height < 900:
        raise SystemExit(f"base-mural.png is too small: {mural.size}")
    for name in INDEPENDENT_TYPES:
        image = Image.open(INPUT_SOURCE / f"{name}.png")
        if "A" not in image.getbands() or image.getchannel("A").getbbox() is None:
            raise SystemExit(f"{name}.png must be a visible RGBA sprite")
        if min(image.size) < 512:
            raise SystemExit(f"{name}.png is too small: {image.size}")


def rubbing_alpha_crop(mural: Image.Image, box: list[int], target_long_edge: int = 1200) -> Image.Image:
    crop = mural.crop(tuple(box)).convert("RGB")
    # Preserve the dark rubbing strokes while removing the pale stone/paper field.
    gray = np.asarray(ImageOps.grayscale(crop), dtype=np.float32)
    local = np.asarray(ImageOps.grayscale(crop.filter(ImageFilter.GaussianBlur(radius=5.0))), dtype=np.float32)
    detail = np.clip(local - gray - 2.0, 0.0, 58.0)
    darkness = np.clip((188.0 - gray) * 3.05, 0.0, 255.0)
    alpha = np.clip(darkness * 0.94 + detail * 1.10, 0.0, 255.0).astype(np.uint8)
    alpha[alpha < 36] = 0
    # Remove isolated speckle while retaining engraved linework.
    alpha_image = Image.fromarray(alpha, mode="L").filter(ImageFilter.MedianFilter(size=3))
    ink = np.asarray(crop, dtype=np.float32)
    luminance = gray[..., None]
    neutral = np.clip(16 + luminance * 0.13, 16, 58)
    rgba = np.concatenate([np.repeat(neutral, 3, axis=2), np.asarray(alpha_image, dtype=np.uint8)[..., None]], axis=2).astype(np.uint8)
    image = Image.fromarray(rgba, mode="RGBA")
    bbox = image.getchannel("A").getbbox()
    if bbox:
        image = image.crop(bbox)
    pad = max(18, int(max(image.size) * 0.035))
    image = ImageOps.expand(image, border=pad, fill=(0, 0, 0, 0))
    if max(image.size) > target_long_edge:
        scale = target_long_edge / max(image.size)
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    return image


def build_mural_crops(paths: BuildPaths) -> list[dict[str, object]]:
    mural = Image.open(INPUT_SOURCE / "base-mural.png").convert("RGB")
    for old in paths.source_crops.glob("*.png"):
        old.unlink()
    entries: list[dict[str, object]] = []
    semantic_seen: set[bytes] = set()
    for recipe in MURAL_CROP_RECIPES:
        image = rubbing_alpha_crop(mural, recipe["box"])
        pixel_bytes = image.tobytes()
        if pixel_bytes in semantic_seen:
            raise RuntimeError(f"duplicate mural crop pixels: {recipe['id']}")
        semantic_seen.add(pixel_bytes)
        filename = f"{recipe['id']}.png"
        save_png(image, paths.source_crops / filename)
        meta = TYPE_META[str(recipe["kind"])]
        entries.append({
            "id": recipe["id"],
            "kind": recipe["kind"],
            "label": meta["label"],
            "audioGroup": meta["audio"],
            "animation": meta["animation"],
            "color": meta["color"],
            "file": f"assets/source-highres/mural-crops/{filename}",
            "sourceFile": "assets/source-highres/base-mural.png",
            "cropBox": recipe["box"],
            "provenance": "deterministic-distinct-crop-from-project-owned-mural",
            "width": image.width,
            "height": image.height,
        })
    manifest = {
        "version": 1,
        "count": len(entries),
        "independentSourceCount": len(INDEPENDENT_TYPES),
        "totalDistinctBaseSilhouetteCount": len(INDEPENDENT_TYPES) + len(entries),
        "assets": entries,
    }
    (paths.source_crops / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return entries


def independent_catalog() -> list[dict[str, object]]:
    result = []
    for name in INDEPENDENT_TYPES:
        meta = TYPE_META[name]
        result.append({
            "id": f"independent-{name}",
            "kind": name,
            "label": meta["label"],
            "audioGroup": meta["audio"],
            "animation": meta["animation"],
            "color": meta["color"],
            "file": f"assets/source-highres/{name}.png",
            "inputPath": INPUT_SOURCE / f"{name}.png",
            "provenance": "independently-generated-project-owned-source",
        })
    return result


def prepared_source(path: Path, target_height: int = 760) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if bbox:
        image = image.crop(bbox)
    pad = max(14, int(max(image.size) * 0.035))
    image = ImageOps.expand(image, border=pad, fill=(0, 0, 0, 0))
    if image.height > target_height:
        scale = target_height / image.height
        image = image.resize((max(1, round(image.width * scale)), target_height), Image.Resampling.LANCZOS)
    return image


def runtime_ready(image: Image.Image, max_dimension: int = 960) -> Image.Image:
    """Cap generated runtime sprites at the renderer's useful source resolution."""
    if max(image.size) <= max_dimension:
        return image
    scale = max_dimension / max(image.size)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)


def compose_group(items: list[tuple[Image.Image, float, float, float, bool]], size: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    for image, center_x, bottom_y, scale, mirror in items:
        sprite = ImageOps.mirror(image) if mirror else image
        target = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.Resampling.LANCZOS)
        x = round(center_x * size[0] - target.width / 2)
        y = round(bottom_y * size[1] - target.height)
        canvas.alpha_composite(target, (x, y))
    bbox = canvas.getchannel("A").getbbox()
    if bbox:
        canvas = canvas.crop(bbox)
    return ImageOps.expand(canvas, border=24, fill=(0, 0, 0, 0))


def source_path(entry: dict[str, object], paths: BuildPaths) -> Path:
    input_path = entry.get("inputPath")
    if isinstance(input_path, Path):
        return input_path
    return paths.root / str(entry["file"])


def build_background(paths: BuildPaths) -> None:
    mural = Image.open(INPUT_SOURCE / "base-mural.png").convert("RGB")
    mural = ImageEnhance.Contrast(mural).enhance(1.02)
    mural = ImageEnhance.Brightness(mural).enhance(1.02)
    mural = mural.resize((2048, 1152), Image.Resampling.LANCZOS)
    mural.save(paths.background / "mural-texture.jpg", format="JPEG", quality=91, subsampling=0, optimize=False, progressive=False)


def asset_entry(asset_id: str, filename: str, source_entries: list[dict[str, object]], composition: str,
                width: int, height: int, mirrored: bool = False) -> dict[str, object]:
    dominant = source_entries[0]
    return {
        "id": asset_id,
        "file": f"assets/sprites/variants/{filename}",
        "kind": dominant["kind"],
        "label": dominant["label"],
        "audioGroup": dominant["audioGroup"],
        "animation": dominant["animation"],
        "color": dominant["color"],
        "composition": composition,
        "derivedFrom": [entry["id"] for entry in source_entries],
        "mirrored": mirrored,
        "width": width,
        "height": height,
    }


def build_visuals(paths: BuildPaths, crop_entries: list[dict[str, object]]) -> list[dict[str, object]]:
    build_background(paths)
    catalog = [*independent_catalog(), *crop_entries]
    prepared = {str(entry["id"]): prepared_source(source_path(entry, paths)) for entry in catalog}
    by_id = {str(entry["id"]): entry for entry in catalog}
    for old in paths.sprites.glob("*.png"):
        old.unlink()
    runtime: list[dict[str, object]] = []

    # 32 genuinely distinct solo silhouettes/groups. No mirror-only duplicate is counted.
    for entry in catalog:
        source_id = str(entry["id"])
        image = runtime_ready(prepared[source_id])
        filename = f"solo-{source_id}.png"
        save_png(image, paths.sprites / filename)
        runtime.append(asset_entry(filename[:-4], filename, [entry], "solo", image.width, image.height))

    duo_ids = [
        ("independent-qin", "mural-standing-reed"),
        ("mural-pipa-seated", "mural-bell-striker"),
        ("mural-bowed-string", "mural-panpipe-seated"),
        ("mural-grand-drum-duo", "mural-cymbal-dancer"),
        ("mural-ribbon-duo-left", "mural-tray-procession"),
        ("mural-cup-kneeler-left", "mural-cup-kneeler-right"),
        ("mural-acrobat-ribbon", "mural-standing-server"),
        ("independent-dancer", "mural-sleeve-dancer"),
        ("independent-flute", "mural-horn-standing"),
        ("independent-pipa", "mural-banquet-duo"),
        ("independent-drum", "mural-drum-player"),
        ("independent-attendant", "mural-left-attendant"),
    ]
    for index, ids in enumerate(duo_ids, 1):
        entries = [by_id[item] for item in ids]
        image = compose_group([
            (prepared[ids[0]], 0.32, 0.96, 0.96, False),
            (prepared[ids[1]], 0.68, 0.96, 0.94, index % 3 == 0),
        ], (1120, 860))
        image = runtime_ready(image)
        filename = f"duo-{index:02d}-{'-'.join(item.replace('independent-', '').replace('mural-', '') for item in ids)}.png"
        save_png(image, paths.sprites / filename)
        runtime.append(asset_entry(filename[:-4], filename, entries, "duo", image.width, image.height))

    trio_ids = [
        ("mural-qin-platform", "mural-standing-reed", "mural-pipa-seated"),
        ("mural-bell-rack-ensemble", "mural-bell-striker", "mural-bowed-string"),
        ("mural-panpipe-seated", "mural-grand-drum-duo", "mural-drum-player"),
        ("mural-left-attendant", "mural-ribbon-duo-left", "mural-cymbal-dancer"),
        ("mural-tray-procession", "mural-cup-kneeler-left", "mural-banquet-duo"),
        ("mural-cup-kneeler-right", "mural-standing-server", "mural-acrobat-ribbon"),
        ("mural-sleeve-dancer", "mural-right-procession", "mural-horn-standing"),
        ("independent-erhu", "independent-dancer", "mural-dance-banquet-group"),
    ]
    for index, ids in enumerate(trio_ids, 1):
        entries = [by_id[item] for item in ids]
        image = compose_group([
            (prepared[ids[0]], 0.22, 0.97, 0.86, False),
            (prepared[ids[1]], 0.50, 0.93, 0.96, index % 2 == 0),
            (prepared[ids[2]], 0.78, 0.97, 0.86, False),
        ], (1340, 920))
        image = runtime_ready(image)
        filename = f"trio-{index:02d}.png"
        save_png(image, paths.sprites / filename)
        runtime.append(asset_entry(filename[:-4], filename, entries, "trio", image.width, image.height))

    ensemble_ids = [
        ("mural-qin-platform", "mural-standing-reed", "mural-pipa-seated", "mural-bell-striker"),
        ("mural-bell-rack-ensemble", "mural-bowed-string", "mural-panpipe-seated", "mural-grand-drum-duo"),
        ("mural-ribbon-duo-left", "mural-cymbal-dancer", "mural-tray-procession", "mural-left-attendant"),
        ("mural-cup-kneeler-left", "mural-banquet-table", "mural-cup-kneeler-right", "mural-standing-server"),
        ("mural-acrobat-ribbon", "mural-sleeve-dancer", "mural-right-procession", "mural-horn-standing"),
        ("independent-qin", "independent-flute", "independent-pipa", "independent-erhu", "independent-attendant"),
        ("independent-drum", "mural-drum-player", "mural-grand-drum-duo", "mural-cymbal-dancer"),
        ("mural-ritual-trio", "mural-banquet-duo", "mural-dance-banquet-group", "independent-dancer"),
    ]
    for index, ids in enumerate(ensemble_ids, 1):
        entries = [by_id[item] for item in ids]
        count = len(ids)
        centers = np.linspace(0.16, 0.84, count)
        items = []
        for item_index, source_id in enumerate(ids):
            scale = 0.76 if count >= 5 else (0.78 if item_index in (0, count - 1) else 0.88)
            items.append((prepared[source_id], float(centers[item_index]), 0.97 if item_index % 2 == 0 else 0.93, scale, bool((index + item_index) % 4 == 0)))
        image = compose_group(items, (1540, 980))
        image = runtime_ready(image)
        filename = f"ensemble-{index:02d}.png"
        save_png(image, paths.sprites / filename)
        runtime.append(asset_entry(filename[:-4], filename, entries, "ensemble", image.width, image.height))

    if len(runtime) != 60:
        raise RuntimeError(f"runtime asset count must be 60, got {len(runtime)}")
    runtime_manifest = {
        "version": 3,
        "count": len(runtime),
        "distinctBaseSilhouetteCount": len(catalog),
        "independentHighResSourceCount": len(INDEPENDENT_TYPES),
        "muralDerivedDistinctSourceCount": len(crop_entries),
        "assets": runtime,
    }
    (paths.assets / "sprites" / "manifest.json").parent.mkdir(parents=True, exist_ok=True)
    (paths.assets / "sprites" / "manifest.json").write_text(json.dumps(runtime_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    build_contact_sheet(paths, runtime)
    return runtime


def build_contact_sheet(paths: BuildPaths, manifest: list[dict[str, object]]) -> None:
    thumb_w, thumb_h, columns = 250, 185, 6
    rows = math.ceil(len(manifest) / columns)
    sheet = Image.new("RGB", (columns * thumb_w, rows * thumb_h), (218, 211, 194))
    draw = ImageDraw.Draw(sheet)
    for index, entry in enumerate(manifest):
        image = Image.open(paths.root / str(entry["file"])).convert("RGBA")
        image.thumbnail((thumb_w - 16, thumb_h - 30), Image.Resampling.LANCZOS)
        x = (index % columns) * thumb_w + (thumb_w - image.width) // 2
        y = (index // columns) * thumb_h + 4
        sheet.paste(image, (x, y), image)
        draw.text(((index % columns) * thumb_w + 6, (index // columns) * thumb_h + thumb_h - 20), str(entry["id"]), fill=(42, 38, 31))
    sheet.save(paths.docs / "asset-contact-sheet.jpg", format="JPEG", quality=90, subsampling=0, optimize=False, progressive=False)


def weighted_row(count: int, y: float, h: float, weights: list[float], x0: float, x1: float, gap: float,
                 role: str, start_index: int) -> list[dict[str, object]]:
    usable = x1 - x0 - gap * (count - 1)
    total = sum(weights)
    x = x0
    result = []
    for offset, weight in enumerate(weights):
        width = usable * weight / total
        result.append({"id": start_index + offset, "x": x, "y": y, "w": width, "h": h, "role": role})
        x += width + gap
    return result


def segmented_row(left_count: int, right_count: int, y: float, h: float, left_weights: list[float],
                  right_weights: list[float], role: str, start_index: int, central_count: int = 1) -> list[dict[str, object]]:
    left = weighted_row(left_count, y, h, left_weights, 0.052, 0.394, 0.0045, role, start_index)
    central = weighted_row(central_count, y - 0.005, h + 0.01, [1] * central_count, 0.406, 0.594, 0.004, "central-stage", start_index + left_count)
    right = weighted_row(right_count, y, h, right_weights, 0.606, 0.948, 0.0045, role, start_index + left_count + central_count)
    return [*left, *central, *right]


def landscape_slots() -> list[dict[str, object]]:
    slots: list[dict[str, object]] = []
    slots += weighted_row(12, 0.145, 0.108, [1.0, .78, 1.08, .88, 1.12, .82, .92, 1.16, .84, 1.08, .78, 1.02], 0.052, 0.948, 0.0042, "upper-gallery", len(slots))
    slots += segmented_row(6, 6, 0.275, 0.138, [1.0, .82, 1.12, .92, 1.08, .86], [.86, 1.08, .92, 1.12, .82, 1.0], "upper-hall", len(slots), 1)
    slots += segmented_row(5, 5, 0.437, 0.145, [1.0, .86, 1.18, .86, 1.1], [1.1, .86, 1.18, .86, 1.0], "middle-hall", len(slots), 1)
    slots += segmented_row(6, 6, 0.608, 0.128, [.86, 1.12, .92, 1.04, .82, 1.08], [1.08, .82, 1.04, .92, 1.12, .86], "lower-hall", len(slots), 1)
    slots += segmented_row(6, 6, 0.758, 0.145, [1.0, .84, 1.12, .9, 1.06, .88], [.88, 1.06, .9, 1.12, .84, 1.0], "lower-gallery", len(slots), 2)
    if len(slots) != 63:
        raise RuntimeError(f"landscape visual slot count must be 63, got {len(slots)}")
    return slots


def row_bays(count: int, y: float, h: float, weights: list[float], gap: float, x_start: float) -> list[dict[str, float]]:
    usable = 1 - x_start * 2 - gap * (count - 1)
    total = sum(weights)
    x = x_start
    result = []
    for weight in weights:
        width = usable * weight / total
        result.append({"x": x, "y": y, "w": width, "h": h})
        x += width + gap
    return result


def portrait_bays() -> list[dict[str, float]]:
    result = []
    heights = [.105, .105, .115, .145, .115, .105, .105]
    y = .095
    for row, height in enumerate(heights):
        weights = [.9, 1.4, .9] if row == 3 else ([1.12, .88, 1.12] if row % 2 else [1, 1, 1])
        result.extend(row_bays(3, y, height, weights, .014, .045))
        y += height + .012
    return result


def portrait_node_rect(bay: dict[str, float], slot: int) -> dict[str, float]:
    patterns = [(0.03, 0.12, 0.29, 0.78), (0.355, 0.06, 0.29, 0.84), (0.68, 0.12, 0.29, 0.78)]
    px, py, pw, ph = patterns[slot]
    return {
        "x": round(bay["x"] + bay["w"] * px, 6),
        "y": round(bay["y"] + bay["h"] * py, 6),
        "w": round(bay["w"] * pw, 6),
        "h": round(bay["h"] * ph, 6),
    }


def rect_only(slot: dict[str, object], inset: float = 0.045) -> dict[str, float]:
    x, y, w, h = float(slot["x"]), float(slot["y"]), float(slot["w"]), float(slot["h"])
    return {
        "x": round(x + w * inset, 6),
        "y": round(y + h * 0.025, 6),
        "w": round(w * (1 - inset * 2), 6),
        "h": round(h * 0.95, 6),
    }


def composition_rect(slot: dict[str, object], composition: str) -> dict[str, float]:
    x, y, w, h = float(slot["x"]), float(slot["y"]), float(slot["w"]), float(slot["h"])
    central = slot["role"] == "central-stage"
    if central:
        return {"x": round(x + w * .012, 6), "y": round(y + h * .015, 6),
                "w": round(w * .976, 6), "h": round(h * .97, 6)}
    width_factor = {"solo": .94, "duo": 1.30, "trio": 1.72, "ensemble": 2.18}[composition]
    height_factor = {"solo": .95, "duo": 1.02, "trio": 1.08, "ensemble": 1.13}[composition]
    target_w = w * width_factor
    target_h = h * height_factor
    target_x = x + (w - target_w) * .5
    target_y = y + (h - target_h) * .52
    if target_x < .048:
        target_x = .048
    if target_x + target_w > .952:
        target_x = .952 - target_w
    target_y = max(.128, min(target_y, .918 - target_h))
    return {"x": round(target_x, 6), "y": round(target_y, 6),
            "w": round(target_w, 6), "h": round(target_h, 6)}


CENTRAL_CORE_RECTS = {
    18: {"x": .398, "y": .252, "w": .204, "h": .165},
    30: {"x": .393, "y": .405, "w": .214, "h": .185},
    42: {"x": .382, "y": .552, "w": .236, "h": .190},
    55: {"x": .360, "y": .704, "w": .280, "h": .165},
    56: {"x": .330, "y": .800, "w": .340, "h": .110},
}


def build_scene(paths: BuildPaths, runtime: list[dict[str, object]]) -> None:
    landscape = landscape_slots()
    portrait = portrait_bays()
    # V2 uses the complete 60-sprite catalog. Narrow bays receive large solos;
    # wider galleries receive curated duos/trios, while the central tower gets
    # full ensembles. Each composition remains controlled by exactly one bay.
    pools = {
        composition: [index for index, asset in enumerate(runtime) if asset["composition"] == composition]
        for composition in ("solo", "duo", "trio", "ensemble")
    }
    if any(not values for values in pools.values()):
        raise RuntimeError(f"incomplete runtime composition pools: {pools}")
    central_slot_ids = [18, 30, 42, 55, 56]
    pool_cursor = {name: 0 for name in pools}
    secondary_colors = {
        "pluck": "#e1bd54", "flute": "#72b7a6", "strike": "#f2c85b",
        "bow": "#6ea3bd", "drum": "#e55b38", "dance": "#d66a91",
        "serve": "#9bb365", "reed": "#9eb45b", "panpipe": "#70b6ad",
        "harp": "#ddb753", "clapper": "#e08b45", "cymbal": "#f0c75c",
        "acrobat": "#d85b8b", "procession": "#9bb65d", "banquet": "#78a9af",
        "gong": "#ef6e35", "horn": "#c99755", "sway": "#a08c65",
    }
    beat_periods = {
        "strike": 2.0, "drum": .5, "gong": 2.0, "clapper": .5,
        "cymbal": 2.0, "pluck": 1.0, "harp": 1.0, "dance": .5,
        "acrobat": .5, "procession": 1.0, "flute": 2.0, "reed": 2.0,
        "panpipe": 2.0, "bow": 2.0, "horn": 4.0, "banquet": 2.0,
        "serve": 2.0,
    }

    nodes = []
    for cell_id in range(63):
        slot = landscape[cell_id]
        portrait_bay_id = cell_id // 3
        portrait_slot = cell_id % 3
        central = slot["role"] == "central-stage"
        slot_ratio = float(slot["w"]) / float(slot["h"])
        if central:
            composition = "ensemble" if cell_id in {18, 42, 55} else "trio"
        elif slot_ratio > .68 or (slot_ratio > .52 and cell_id % 5 == 0):
            composition = "trio"
        elif slot_ratio > .42 and cell_id % 4 == 0:
            composition = "duo"
        else:
            composition = "solo"
        pool = pools[composition]
        asset = runtime[pool[pool_cursor[composition] % len(pool)]]
        pool_cursor[composition] += 1
        clean_independent = str(asset["id"]).startswith("solo-independent-")
        scale = (1.20 if clean_independent else 1.12) + ((cell_id * 17) % 5) / 100
        landscape_rect = CENTRAL_CORE_RECTS[cell_id] if central else rect_only(slot, .008)
        # Mural crops contain useful archaeological context around the figure.
        # Cover-fit trims that frame and makes the performer, not the crop box,
        # dominate the bay. Clean transparent figures keep contain-fit.
        fit_mode = "contain" if clean_independent else "cover"
        nodes.append({
            "id": cell_id,
            "triggerRow": cell_id // 9,
            "triggerCol": cell_id % 9,
            "visualPanelId": cell_id,
            "visualRole": slot["role"],
            "sprite": asset["file"],
            "assetId": asset["id"],
            "composition": composition,
            "label": asset["label"],
            "audioGroup": asset["audioGroup"],
            "animation": asset["animation"],
            "color": asset["color"],
            "secondaryColor": secondary_colors.get(str(asset["animation"]), "#d0a451"),
            "beatPeriod": beat_periods.get(str(asset["animation"]), 1.0),
            "beatOffset": 0,
            "scale": round(scale, 3),
            "yBias": round((((cell_id * 7) % 5) - 2) * .008, 3),
            "mirror": bool(cell_id % 11 == 0 and composition == "solo"),
            "phase": round(((cell_id * .61803398875) % 1) * math.pi * 2, 5),
            "motion": round(.72 + ((cell_id * 29) % 17) / 22, 3),
            "upperSplit": round(.46 + ((cell_id * 13) % 12) / 100, 3),
            "pivotY": round(.61 + ((cell_id * 5) % 10) / 100, 3),
            "idleOpacity": round((.17 if central else .135) + ((cell_id * 19) % 5) / 100, 3),
            "fitMode": fit_mode,
            "landscape": {key: round(float(value), 6) for key, value in landscape_rect.items()},
            "portrait": portrait_node_rect(portrait[portrait_bay_id], portrait_slot),
        })

    used_groups = {str(node["audioGroup"]) for node in nodes}
    missing_groups = [group_id for group_id, _label, _gain, _send in VOICE_AUDIO_META if group_id not in used_groups]
    if missing_groups:
        raise RuntimeError(f"V2 scene failed to place audio groups: {missing_groups}")
    audio_groups = [
        {"id": "ambience", "label": "厅堂环境", "file": "assets/audio/ambience.wav", "gain": .055, "reverbSend": .62},
        *[
            {"id": group_id, "label": label, "file": f"assets/audio/{group_id}.wav", "gain": gain, "reverbSend": send}
            for group_id, label, gain, send in VOICE_AUDIO_META
        ],
    ]
    scene = {
        "version": 3,
        "name": "汉画像·百戏乐舞 V2",
        "trigger": {"rows": 7, "cols": 9, "coordinateSpace": "normalized-camera-plane"},
        "palette": {"paper": "#cbb28a", "ink": "#21170f", "accent": "#a84429"},
        "background": {"runtime": "assets/background/mural-texture.jpg", "source": "assets/source-highres/base-mural.png"},
        "visualStructure": {
            "layoutVersion": 3,
            "landscapePanelCount": 63,
            "centralStagePanelIds": central_slot_ids,
            "sideBorderCount": 2,
            "horizontalBeamCount": 8,
            "description": "dense three-tier portrait-stone orchestra wall with bay-local solos, ensembles and a central ritual stage",
        },
        "assetStats": {
            "runtimeSpriteCount": len(runtime),
            "distinctBaseSilhouetteCount": 32,
            "independentHighResSourceCount": 8,
            "muralDerivedDistinctSourceCount": 24,
        },
        "audioGroups": audio_groups,
        "nodes": nodes,
    }
    (paths.config / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def adsr(length: float, attack: float = .01, decay: float = .08, sustain: float = .5, release: float = .25) -> np.ndarray:
    samples = max(1, int(length * SR))
    env = np.ones(samples) * sustain
    a = min(samples, int(attack * SR)); d = min(max(0, samples - a), int(decay * SR)); r = min(samples, int(release * SR))
    if a: env[:a] = np.linspace(0, 1, a, endpoint=False)
    if d: env[a:a + d] = np.linspace(1, sustain, d, endpoint=False)
    if r: env[-r:] *= np.linspace(1, 0, r)
    return env


def add_tone(buffer: np.ndarray, start: float, duration: float, frequency: float, amplitude: float = .2,
             harmonics: tuple[float, ...] = (1,), vibrato: float = 0, noise: float = 0, pluck: bool = False) -> None:
    i0 = int(start * SR); count = min(int(duration * SR), N - i0)
    if count <= 0: return
    t = np.arange(count) / SR
    phase = 2 * np.pi * frequency * t
    if vibrato: phase = 2 * np.pi * frequency * (t + (vibrato / (2 * np.pi * 5)) * np.sin(2 * np.pi * 5 * t))
    signal = np.zeros(count)
    for harmonic, gain in enumerate(harmonics, 1): signal += gain * np.sin(harmonic * phase)
    if pluck:
        envelope = np.exp(-t * (3.2 + frequency / 600)); signal *= envelope; signal += .12 * RNG.standard_normal(count) * np.exp(-t * 28)
    else:
        envelope = adsr(duration, .06, .18, .72, .35)[:count]; signal *= envelope
    if noise: signal += noise * RNG.standard_normal(count) * envelope
    buffer[i0:i0 + count] += amplitude * signal


def add_bell(buffer: np.ndarray, start: float, frequency: float, amplitude: float = .28, duration: float = 2.5) -> None:
    i0 = int(start * SR); count = min(int(duration * SR), N - i0); t = np.arange(count) / SR
    signal = sum(gain * np.sin(2 * np.pi * frequency * ratio * t) for gain, ratio in zip((1, .45, .24, .13), (1, 2.71, 4.05, 5.43)))
    signal *= np.exp(-t * 2.15); signal += .03 * RNG.standard_normal(count) * np.exp(-t * 18)
    buffer[i0:i0 + count] += amplitude * signal


def add_drum(buffer: np.ndarray, start: float, amplitude: float = .65, kind: str = "low") -> None:
    duration = .55 if kind == "low" else .18; i0 = int(start * SR); count = min(int(duration * SR), N - i0); t = np.arange(count) / SR
    if kind == "low":
        frequency = 90 * np.exp(-t * 4) + 42; phase = 2 * np.pi * np.cumsum(frequency) / SR
        signal = np.sin(phase) * np.exp(-t * 7) + .14 * RNG.standard_normal(count) * np.exp(-t * 18)
    else:
        signal = RNG.standard_normal(count) * np.exp(-t * 28) + .25 * np.sin(2 * np.pi * 900 * t) * np.exp(-t * 35)
    buffer[i0:i0 + count] += amplitude * signal


def write_wav(paths: BuildPaths, name: str, buffer: np.ndarray, gain: float = .92) -> None:
    fade = int(.04 * SR); buffer[:fade] *= np.linspace(0, 1, fade); buffer[-fade:] *= np.linspace(1, 0, fade)
    buffer = np.tanh(buffer * 1.15); peak = float(np.max(np.abs(buffer))) or 1
    pcm = np.int16(np.clip(buffer / peak * gain, -1, 1) * 32767)
    with wave.open(str(paths.audio / f"{name}.wav"), "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(SR); wav.writeframes(pcm.tobytes())


def add_click(buffer: np.ndarray, start: float, frequency: float = 1600, amplitude: float = .3,
              duration: float = .075, woody: bool = True) -> None:
    i0 = int(start * SR); count = min(int(duration * SR), N - i0)
    if count <= 0: return
    t = np.arange(count) / SR
    noise = RNG.standard_normal(count)
    ring = np.sin(2 * np.pi * frequency * t) + .36 * np.sin(2 * np.pi * frequency * 1.87 * t)
    signal = (.52 * noise + ring) * np.exp(-t * (46 if woody else 24))
    if not woody: signal += .24 * np.sin(2 * np.pi * frequency * 2.73 * t) * np.exp(-t * 12)
    buffer[i0:i0 + count] += amplitude * signal


def add_breathy_tone(buffer: np.ndarray, start: float, duration: float, frequency: float, amplitude: float,
                     harmonics: tuple[float, ...], vibrato: float = .003, breath: float = .035) -> None:
    i0 = int(start * SR); count = min(int(duration * SR), N - i0)
    if count <= 0: return
    t = np.arange(count) / SR
    drift = 1 + .0018 * np.sin(2 * np.pi * .37 * t + start)
    phase = 2 * np.pi * np.cumsum(frequency * drift * (1 + vibrato * np.sin(2 * np.pi * 5.1 * t))) / SR
    signal = np.zeros(count)
    for harmonic, gain in enumerate(harmonics, 1):
        signal += gain * np.sin(harmonic * phase + harmonic * .13)
    envelope = adsr(duration, .11, .2, .76, .42)[:count]
    shaped_noise = RNG.standard_normal(count)
    shaped_noise[1:] = shaped_noise[1:] * .55 + shaped_noise[:-1] * .45
    buffer[i0:i0 + count] += amplitude * (signal + breath * shaped_noise) * envelope


def add_metal_swell(buffer: np.ndarray, start: float, amplitude: float = .22, duration: float = 1.8) -> None:
    i0 = int(start * SR); count = min(int(duration * SR), N - i0)
    if count <= 0: return
    t = np.arange(count) / SR
    ratios = (1, 1.37, 1.93, 2.71, 4.11)
    base = 410 + (int(start * 10) % 5) * 37
    ring = sum(np.sin(2 * np.pi * base * ratio * t + ratio) / (1 + ratio * .34) for ratio in ratios)
    noise = RNG.standard_normal(count)
    envelope = (1 - np.exp(-t * 35)) * np.exp(-t * 2.05)
    buffer[i0:i0 + count] += amplitude * (ring + noise * .28) * envelope


def moving_average(signal: np.ndarray, window: int) -> np.ndarray:
    window = max(2, int(window))
    cumulative = np.cumsum(np.concatenate(([0.0], signal)), dtype=np.float64)
    averaged = (cumulative[window:] - cumulative[:-window]) / window
    left = window // 2
    right = len(signal) - len(averaged) - left
    return np.pad(averaged, (left, right), mode="edge")


def add_room_texture(buffer: np.ndarray, amount: float = .006) -> np.ndarray:
    noise = RNG.standard_normal(N)
    # A small, deterministic air/room bed makes isolated layers feel recorded
    # in the same hall without hiding their attacks.
    smooth = moving_average(noise, 31)
    drift = np.sin(2 * np.pi * np.arange(N) / SR * .071 + .9)
    return buffer + amount * smooth * (1 + .25 * drift)


def build_audio(paths: BuildPaths) -> None:
    global RNG
    RNG = np.random.default_rng(20260731)
    for old in paths.audio.glob("*.wav"):
        old.unlink()
    t = np.arange(N) / SR
    pentatonic = [220.0, 246.94, 293.66, 329.63, 392.0]
    bar_starts = np.arange(0, DURATION, 4.0)

    ambience = sum(amplitude * np.sin(2 * np.pi * frequency * t + RNG.random() * 2 * np.pi)
                   for frequency, amplitude in [(41.25, .025), (55, .022), (82.5, .014), (110, .008)])
    raw_noise = RNG.standard_normal(N)
    smooth = moving_average(raw_noise, 1800)
    write_wav(paths, "ambience", ambience + .12 * smooth, .56)

    voices: dict[str, np.ndarray] = {group_id: np.zeros(N) for group_id, _label, _gain, _send in VOICE_AUDIO_META}

    # Plucked strings: different registers, attack materials and rhythmic roles.
    melody = [0, 2, 4, 1, 3, 4, 2, 0, 1, 3, 2, 4, 3, 1, 0, 2, 4, 2, 1, 0, 3, 4, 2, 1, 0, 2, 3, 4, 2, 1, 3, 0]
    for index, note in enumerate(melody):
        add_tone(voices["qin"], index, .92, pentatonic[note] * (.5 if index % 8 == 0 else 1), .25, (1, .43, .19, .08), pluck=True)
        if index % 4 == 0: add_tone(voices["qin"], index + .035, 1.4, pentatonic[(note + 2) % 5] / 2, .11, (1, .3, .1), pluck=True)
    for bar in range(8):
        chord = [pentatonic[bar % 5], pentatonic[(bar + 2) % 5], pentatonic[(bar + 4) % 5]]
        for step in range(12):
            start = bar * 4 + step / 3
            add_tone(voices["pipa"], start, .38, chord[(step * 2 + bar) % 3] * 2, .135 if step % 3 else .21, (1, .58, .27, .11), pluck=True)
    for bar in range(8):
        for step, note in enumerate((0, 3, 1, 4, 2, 4, 1, 3)):
            add_tone(voices["se"], bar * 4 + step * .5, 1.12, pentatonic[(note + bar) % 5] * .75, .19, (1, .34, .13, .05), pluck=True)

    # Winds and bowed voices carry longer phrases with breath/bow texture.
    for bar, start in enumerate(bar_starts):
        notes = (0, 2, 4, 3) if bar % 2 == 0 else (1, 3, 2, 0)
        for step, note in enumerate(notes):
            add_breathy_tone(voices["dizi"], float(start + step), .88, pentatonic[note] * 2, .13, (1, .24, .08), .0038, .055)
        add_breathy_tone(voices["panpipe"], float(start + .12), 1.72, pentatonic[(bar + 1) % 5], .12, (1, .31, .12), .0021, .075)
        add_breathy_tone(voices["panpipe"], float(start + 2.1), 1.55, pentatonic[(bar + 3) % 5] * 1.5, .105, (1, .27, .09), .0024, .08)
        add_breathy_tone(voices["horn"], float(start), 3.35, pentatonic[(bar * 2) % 5] / 2, .11, (1, .48, .22, .08), .0012, .025)
        for chord_note in (0, 2, 4):
            add_breathy_tone(voices["sheng"], float(start + .04), 3.55, pentatonic[(bar + chord_note) % 5], .055, (1, .18, .06), .0014, .032)
        add_tone(voices["bowed-string"], float(start), 3.72, pentatonic[(bar + 2) % 5] * .75, .15, (1, .36, .16, .07), vibrato=.0042, noise=.022)

    # Bronze, stone and ritual resonators each use different inharmonic spectra.
    for start in np.arange(0, DURATION, 2):
        note = int(start / 2) % 5
        add_bell(voices["bronze-bells"], float(start + .015), pentatonic[note] * 1.35, .25 if note in (0, 4) else .18, 2.8)
    for start in np.arange(1, DURATION, 2):
        base = pentatonic[int(start) % 5] * 1.7
        add_click(voices["stone-chime"], float(start), base, .34, .42, False)
        add_tone(voices["stone-chime"], float(start), .65, base * 1.41, .085, (1, .22, .09), pluck=True)
    for start in (3.5, 7.5, 11.5, 15.5, 19.5, 23.5, 27.5, 31.0):
        add_metal_swell(voices["cymbal"], start, .27 if start % 8 > 4 else .2, 1.7)
    for start in np.arange(.25, DURATION, .5):
        add_click(voices["clapper"], float(start), 1250 + (int(start * 2) % 3) * 210, .16 if int(start * 2) % 4 else .27, .085, True)
    for start in np.arange(.125, DURATION, .25):
        if int(start * 8) % 3: add_click(voices["rattle"], float(start), 2500 + (int(start * 8) % 5) * 180, .065, .055, False)

    # A shared four-second pulse binds the independent layers into one ensemble.
    for beat in np.arange(0, DURATION, .5):
        strong = abs(beat % 4) < 1e-7
        half = abs(beat % 2) < 1e-7
        add_drum(voices["war-drum"], float(beat), .48 if strong else (.25 if half else .075), "low" if half else "high")
        if int(beat * 2) % 2 == 0: add_drum(voices["frame-drum"], float(beat + .02), .22 if strong else .13, "high")
        add_drum(voices["sleeve-dance"], float(beat + .25), .075 if not strong else .12, "high")
    for start in bar_starts:
        add_drum(voices["grand-drum"], float(start + .015), .72, "low")
        add_drum(voices["grand-drum"], float(start + 3.5), .34, "low")
        add_bell(voices["processional"], float(start + .1), pentatonic[int(start / 4) % 5] * .55, .11, 3.5)
        add_click(voices["processional"], float(start + 2), 780, .12, .11, True)
    for start in np.arange(.25, DURATION, .5):
        add_click(voices["sleeve-dance"], float(start), 3100 + (int(start * 2) % 4) * 230, .055, .05, False)

    for group_id, buffer in voices.items():
        write_wav(paths, group_id, add_room_texture(buffer, .0045 if group_id not in {"horn", "sheng", "bowed-string"} else .006))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--visuals", action="store_true", help="rebuild source crops, background, 60 sprites, scene config and contact sheet")
    parser.add_argument("--audio", action="store_true", help="rebuild nineteen synchronized V2 ensemble WAV loops")
    parser.add_argument("--all", action="store_true", help="rebuild all generated outputs")
    parser.add_argument("--output-root", type=Path, default=ROOT, help="write outputs under this root without modifying the project tree")
    args = parser.parse_args()
    validate_inputs()
    paths = paths_for(args.output_root)
    everything = args.all or not (args.visuals or args.audio)
    summary: dict[str, object] = {"outputRoot": str(paths.root)}
    if everything or args.visuals:
        crop_entries = build_mural_crops(paths)
        runtime = build_visuals(paths, crop_entries)
        build_scene(paths, runtime)
        summary.update({"distinctBaseSilhouettes": 32, "muralDerivedSources": len(crop_entries), "runtimeSprites": len(runtime)})
    if everything or args.audio:
        build_audio(paths)
        summary["audioLoops"] = 1 + len(VOICE_AUDIO_META)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
