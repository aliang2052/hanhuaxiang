#!/usr/bin/env python3
"""Prove assets:verify leaves the delivery tree and MANIFEST unchanged."""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_status() -> str | None:
    if not (ROOT / ".git").exists():
        return None
    return subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    ).stdout


def main() -> int:
    manifest_paths = [ROOT / "MANIFEST.json", ROOT / "MANIFEST.sha256"]
    if not all(path.is_file() for path in manifest_paths):
        raise SystemExit("MANIFEST files must exist before preservation test")
    before_manifest = {path.name: digest(path) for path in manifest_paths}
    before_status = git_status()
    result_path = Path(tempfile.gettempdir()) / f"han-asset-preservation-{os.getpid()}.json"
    env = {**os.environ, "ASSET_VERIFY_RESULT": str(result_path)}
    subprocess.run(["npm", "run", "assets:verify"], cwd=ROOT, env=env, check=True)
    subprocess.run(["npm", "run", "manifest:verify"], cwd=ROOT, env=env, check=True)
    after_manifest = {path.name: digest(path) for path in manifest_paths}
    after_status = git_status()
    if before_manifest != after_manifest:
        raise SystemExit(f"manifest files changed: {before_manifest} -> {after_manifest}")
    if before_status != after_status:
        raise SystemExit("git/worktree status changed during assets:verify")
    if not result_path.is_file():
        raise SystemExit("assets:verify did not write its external result file")
    print("Asset preservation test passed: worktree and MANIFEST stayed unchanged; manifest verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
