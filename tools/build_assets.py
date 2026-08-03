#!/usr/bin/env python3
"""Rebuild project-owned visual/audio outputs without online dependencies.

The immutable inputs are:
- assets/source-highres/base-stone-clean-v2.png
- eight independently generated transparent character PNGs in assets/source-highres/
- twenty-four independently generated transparent character/group PNGs in
  assets/source-highres/independent-v2/

Runtime sprites are built from 32 independently designed base sources. No
character is extracted from the mural. Use --output-root to build into a
temporary tree; this is what the non-destructive cross-platform verifier does.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageOps

from build_live_audio import build_live_audio
from live_audio_catalog import ANIMATION_AUDIO_ROLE, LIVE_VOICES, PLAYBACK_GAIN_SCALE

ROOT = Path(__file__).resolve().parents[1]
INPUT_SOURCE = ROOT / "assets" / "source-highres"
ADDITIONAL_SOURCE_DIR = INPUT_SOURCE / "independent-v2"
BACKGROUND_SOURCE_NAME = "base-stone-clean-v2.png"
BACKGROUND_RUNTIME_NAME = "stone-texture-clean-v2.jpg"

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

ADDITIONAL_SOURCE_SPECS = [
    {"id": "mural-qin-platform", "kind": "se"},
    {"id": "mural-standing-reed", "kind": "sheng"},
    {"id": "mural-pipa-seated", "kind": "pipa"},
    {"id": "mural-bell-rack-ensemble", "kind": "bells"},
    {"id": "mural-bell-striker", "kind": "bells"},
    {"id": "mural-bowed-string", "kind": "erhu"},
    {"id": "mural-panpipe-seated", "kind": "panpipe"},
    {"id": "mural-grand-drum-duo", "kind": "gong"},
    {"id": "mural-drum-player", "kind": "drum"},
    {"id": "mural-left-attendant", "kind": "clapper"},
    {"id": "mural-ribbon-duo-left", "kind": "dancer"},
    {"id": "mural-cymbal-dancer", "kind": "cymbal"},
    {"id": "mural-tray-procession", "kind": "procession"},
    {"id": "mural-cup-kneeler-left", "kind": "banquet"},
    {"id": "mural-banquet-table", "kind": "banquet"},
    {"id": "mural-banquet-duo", "kind": "banquet"},
    {"id": "mural-cup-kneeler-right", "kind": "banquet"},
    {"id": "mural-standing-server", "kind": "attendant"},
    {"id": "mural-acrobat-ribbon", "kind": "acrobat"},
    {"id": "mural-sleeve-dancer", "kind": "dancer"},
    {"id": "mural-right-procession", "kind": "procession"},
    {"id": "mural-horn-standing", "kind": "horn"},
    {"id": "mural-ritual-trio", "kind": "procession"},
    {"id": "mural-dance-banquet-group", "kind": "dancer"},
]

@dataclass(frozen=True)
class BuildPaths:
    root: Path
    assets: Path
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
        background=output_root / "assets" / "background",
        sprites=output_root / "assets" / "sprites" / "variants",
        audio=output_root / "assets" / "audio",
        config=output_root / "config",
        docs=output_root / "docs" / "screenshots",
    )
    for directory in (paths.background, paths.sprites, paths.audio, paths.config, paths.docs):
        directory.mkdir(parents=True, exist_ok=True)
    return paths


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", compress_level=6, optimize=False)


def validate_inputs() -> None:
    required = [
        INPUT_SOURCE / BACKGROUND_SOURCE_NAME,
        *[INPUT_SOURCE / f"{name}.png" for name in INDEPENDENT_TYPES],
        *[ADDITIONAL_SOURCE_DIR / f"{spec['id']}.png" for spec in ADDITIONAL_SOURCE_SPECS],
    ]
    missing = [path.relative_to(ROOT).as_posix() for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Missing immutable source assets:\n- " + "\n- ".join(missing))
    background = Image.open(INPUT_SOURCE / BACKGROUND_SOURCE_NAME)
    if background.width < 1600 or background.height < 900:
        raise SystemExit(f"{BACKGROUND_SOURCE_NAME} is too small: {background.size}")
    for name in INDEPENDENT_TYPES:
        image = Image.open(INPUT_SOURCE / f"{name}.png")
        if "A" not in image.getbands() or image.getchannel("A").getbbox() is None:
            raise SystemExit(f"{name}.png must be a visible RGBA sprite")
        if min(image.size) < 512:
            raise SystemExit(f"{name}.png is too small: {image.size}")


def additional_source_catalog() -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    semantic_seen: set[bytes] = set()
    for spec in ADDITIONAL_SOURCE_SPECS:
        source_id = str(spec["id"])
        path = ADDITIONAL_SOURCE_DIR / f"{source_id}.png"
        image = Image.open(path).convert("RGBA")
        if image.getchannel("A").getbbox() is None:
            raise RuntimeError(f"additional source is empty: {path}")
        if min(image.size) < 360:
            raise RuntimeError(f"additional source is too small: {path} {image.size}")
        semantic = image.tobytes()
        if semantic in semantic_seen:
            raise RuntimeError(f"duplicate additional source pixels: {source_id}")
        semantic_seen.add(semantic)
        meta = TYPE_META[str(spec["kind"])]
        entries.append({
            "id": source_id,
            "kind": spec["kind"],
            "label": meta["label"],
            "audioGroup": meta["audio"],
            "animation": meta["animation"],
            "color": meta["color"],
            "file": f"assets/source-highres/independent-v2/{source_id}.png",
            "inputPath": path,
            "provenance": "independently-generated-project-owned-source-v2",
            "width": image.width,
            "height": image.height,
        })
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
    mural = Image.open(INPUT_SOURCE / BACKGROUND_SOURCE_NAME).convert("RGB")
    mural = ImageEnhance.Contrast(mural).enhance(1.02)
    mural = ImageEnhance.Brightness(mural).enhance(1.02)
    mural = mural.resize((2048, 1152), Image.Resampling.LANCZOS)
    mural.save(paths.background / BACKGROUND_RUNTIME_NAME, format="JPEG", quality=91, subsampling=0, optimize=False, progressive=False)


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


def build_visuals(paths: BuildPaths, additional_entries: list[dict[str, object]]) -> list[dict[str, object]]:
    build_background(paths)
    catalog = [*independent_catalog(), *additional_entries]
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
        "version": 4,
        "count": len(runtime),
        "distinctBaseSilhouetteCount": len(catalog),
        "independentHighResSourceCount": len(catalog),
        "additionalIndependentSourceCount": len(additional_entries),
        "muralDerivedDistinctSourceCount": 0,
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
    audio_pools = {
        role: [voice for voice in LIVE_VOICES if voice["role"] == role]
        for role in set(ANIMATION_AUDIO_ROLE.values())
    }
    audio_cursor = {role: 0 for role in audio_pools}
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
        animation = str(asset["animation"])
        audio_role = ANIMATION_AUDIO_ROLE[animation]
        voice_pool = audio_pools[audio_role]
        if audio_cursor[audio_role] >= len(voice_pool):
            raise RuntimeError(f"not enough unique live voices for animation role {audio_role}")
        voice = voice_pool[audio_cursor[audio_role]]
        audio_cursor[audio_role] += 1
        voice_id = f"voice-{LIVE_VOICES.index(voice):02d}-{voice['slug']}"
        scale = 1.16 + ((cell_id * 17) % 5) / 100
        landscape_rect = CENTRAL_CORE_RECTS[cell_id] if central else rect_only(slot, .008)
        # All 32 base sources are transparent, independently designed figures or
        # groups. Contain-fit preserves the complete silhouette without cropping.
        fit_mode = "contain"
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
            "soundLabel": voice["label"],
            "audioGroup": voice_id,
            "animation": animation,
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

    used_groups = [str(node["audioGroup"]) for node in nodes]
    expected_groups = [f"voice-{index:02d}-{voice['slug']}" for index, voice in enumerate(LIVE_VOICES)]
    if len(set(used_groups)) != 63 or set(used_groups) != set(expected_groups):
        raise RuntimeError("V3 scene must assign every one of the 63 live voices exactly once")
    audio_groups = [
        {
            "id": group_id,
            "label": voice["label"],
            "file": f"assets/audio/{group_id}.ogg",
            "gain": round(float(voice["gain"]) * PLAYBACK_GAIN_SCALE, 3),
            "reverbSend": voice["reverbSend"],
            "source": "VCSL CC0 live recording",
            "role": voice["role"],
        }
        for group_id, voice in zip(expected_groups, LIVE_VOICES, strict=True)
    ]
    scene = {
        "version": 4,
        "name": "汉画像·百戏乐舞 V3 Live",
        "trigger": {"rows": 7, "cols": 9, "coordinateSpace": "normalized-camera-plane"},
        "palette": {"paper": "#cbb28a", "ink": "#21170f", "accent": "#a84429"},
        "background": {
            "runtime": f"assets/background/{BACKGROUND_RUNTIME_NAME}",
            "source": f"assets/source-highres/{BACKGROUND_SOURCE_NAME}",
        },
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
            "independentHighResSourceCount": 32,
            "additionalIndependentSourceCount": 24,
            "muralDerivedDistinctSourceCount": 0,
            "recordedAudioVoiceCount": 63,
            "sourceRecordingCount": 246,
        },
        "audioGroups": audio_groups,
        "nodes": nodes,
    }
    (paths.config / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_audio(paths: BuildPaths) -> dict[str, object]:
    """Build 63 one-cell/one-voice loops exclusively from real CC0 recordings."""
    return build_live_audio(paths.audio)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--visuals", action="store_true", help="rebuild background, 60 sprites, scene config and contact sheet")
    parser.add_argument("--audio", action="store_true", help="rebuild 63 one-cell/one-voice V3 live-recording loops")
    parser.add_argument("--all", action="store_true", help="rebuild all generated outputs")
    parser.add_argument("--output-root", type=Path, default=ROOT, help="write outputs under this root without modifying the project tree")
    args = parser.parse_args()
    validate_inputs()
    paths = paths_for(args.output_root)
    everything = args.all or not (args.visuals or args.audio)
    summary: dict[str, object] = {"outputRoot": str(paths.root)}
    if everything or args.visuals:
        additional_entries = additional_source_catalog()
        runtime = build_visuals(paths, additional_entries)
        build_scene(paths, runtime)
        summary.update({
            "distinctBaseSilhouettes": 32,
            "independentHighResSources": len(INDEPENDENT_TYPES) + len(additional_entries),
            "muralDerivedSources": 0,
            "runtimeSprites": len(runtime),
        })
    if everything or args.audio:
        audio_summary = build_audio(paths)
        summary.update({"audioLoops": audio_summary["voiceCount"], "sourceRecordings": audio_summary["recordingCount"]})
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
