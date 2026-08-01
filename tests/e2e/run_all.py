#!/usr/bin/env python3
"""Run E2E phases in isolated process groups.

Each phase writes stdout directly to a file rather than a parent pipe.  The
process group is reaped before the next Chromium launch, avoiding Playwright
pipe/resource races seen when several browser drivers are started back-to-back.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PHASES = (
    "e2e_test.py",
    "camera_race_e2e_test.py",
    "camera_e2e_test.py",
    "reconnect_e2e_test.py",
)


def tail(path: Path, count: int = 6) -> str:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-count:])


def reap_group(process: subprocess.Popen[bytes]) -> None:
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        time.sleep(0.2)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def main() -> int:
    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")
    artifact_root = Path(env.get("E2E_ARTIFACT_DIR", ROOT / "docs")).expanduser().resolve()
    logs = artifact_root / "test-results"
    logs.mkdir(parents=True, exist_ok=True)
    timeout = int(env.get("E2E_PHASE_TIMEOUT_SECONDS", "180"))
    cooldown = max(0.0, float(env.get("E2E_COOLDOWN_SECONDS", "5")))
    started = time.monotonic()
    for index, phase in enumerate(PHASES, 1):
        log_path = logs / f"run-all-{Path(phase).stem}.log"
        print(f"=== E2E phase {index}/{len(PHASES)}: {phase} ===", flush=True)
        with log_path.open("wb") as handle:
            kwargs: dict[str, object] = {
                "cwd": ROOT,
                "env": env,
                "stdout": handle,
                "stderr": subprocess.STDOUT,
            }
            if os.name == "posix":
                kwargs["start_new_session"] = True
            process = subprocess.Popen([sys.executable, str(HERE / phase)], **kwargs)
            try:
                returncode = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                reap_group(process)
                print(tail(log_path, 30), file=sys.stderr)
                print(f"Phase timed out after {timeout}s: {phase}", file=sys.stderr)
                return 124
        reap_group(process)
        print(tail(log_path), flush=True)
        if returncode != 0:
            print(f"Phase failed with exit {returncode}: {phase}", file=sys.stderr)
            return returncode
        if index < len(PHASES) and cooldown:
            print(f"Cooldown {cooldown:g}s", flush=True)
            time.sleep(cooldown)
    print(f"ALL E2E PHASES PASSED in {time.monotonic() - started:.3f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
