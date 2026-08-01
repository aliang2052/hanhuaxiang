#!/usr/bin/env python3
"""Configurable installation soak test.

CI/default: SOAK_SECONDS=30 npm run test:soak
Final venue qualification: SOAK_SECONDS=3600 npm run test:soak

The result is written outside the delivery tree by default so MANIFEST remains
valid. This script does not claim a 60-minute pass unless it actually runs for
that duration.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from e2e_test import ROOT, choose_port, find_browser, state, wait_for, wait_health


def main() -> int:
    duration = max(5, int(float(os.environ.get("SOAK_SECONDS", "30"))))
    sample_interval = max(1.0, float(os.environ.get("SOAK_SAMPLE_SECONDS", "5")))
    min_fps = float(os.environ.get("SOAK_MIN_FPS", "12"))
    max_heap_growth = int(float(os.environ.get("SOAK_MAX_HEAP_GROWTH_MB", "256")) * 1024 * 1024)
    artifact_root = Path(os.environ.get(
        "SOAK_ARTIFACT_DIR",
        Path(tempfile.gettempdir()) / f"hanhuaxiang-soak-{os.getpid()}",
    )).expanduser().resolve()
    artifact_root.mkdir(parents=True, exist_ok=True)
    result_override = os.environ.get("SOAK_RESULT")
    result_path = Path(result_override).expanduser().resolve() if result_override else artifact_root / "soak-results.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    log_path = artifact_root / "soak-server.log"

    port = choose_port()
    base_url = f"http://127.0.0.1:{port}"
    with log_path.open("w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [shutil.which("node") or "node", "server.js", f"--port={port}"],
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )

    started = time.monotonic()
    browser_path = None
    samples: list[dict] = []
    errors: list[str] = []
    external: list[str] = []
    warnings: list[str] = []
    browser = None
    try:
        health = wait_health(base_url)
        with sync_playwright() as playwright:
            browser_path = find_browser(playwright)
            args = ["--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info"]
            if platform.system().lower() == "linux":
                args.extend(["--no-sandbox", "--disable-dev-shm-usage"])
            browser = playwright.chromium.launch(headless=True, executable_path=browser_path, args=args)
            context = browser.new_context(viewport={"width": 1920, "height": 1200})
            page = context.new_page()
            base_netloc = urlparse(base_url).netloc
            page.on("console", lambda message: (
                errors.append(f"{message.type}: {message.text}") if message.type == "error"
                else warnings.append(f"{message.type}: {message.text}") if message.type == "warning" else None
            ))
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.on("request", lambda request: (
                external.append(request.url)
                if urlparse(request.url).scheme in {"http", "https"}
                and urlparse(request.url).netloc != base_netloc else None
            ))
            page.goto(base_url, wait_until="networkidle")
            wait_for(page, "() => window.__HAN_TEST_API__?.getState().ready === true", 20_000)
            page.click("#enterButton")
            wait_for(page, "() => window.__HAN_TEST_API__.getState().entered === true")
            page.evaluate("duration => { window.__HAN_TEST_API__.setMode('auto'); window.__HAN_TEST_API__.wakeAll(duration); }", (duration + 90) * 1000)
            wait_for(page, "() => window.__HAN_TEST_API__.getState().activeCount === 63")

            deadline = time.monotonic() + duration
            next_sample = time.monotonic()
            sample_index = 0
            while time.monotonic() < deadline:
                now = time.monotonic()
                if now < next_sample:
                    page.wait_for_timeout(int(min(500, (next_sample - now) * 1000)))
                    continue
                current = state(page)
                sample_index += 1
                samples.append({
                    "elapsedSeconds": round(now - started, 3),
                    "fps": current["fps"],
                    "activeCount": current["activeCount"],
                    "rendererDrawn": current["rendererDrawn"],
                    "runtimeErrors": current["runtimeErrors"],
                    "heapBytes": current.get("memory", {}).get("usedJSHeapSize") if current.get("memory") else None,
                })
                # Exercise a non-rendering control path every tenth sample, then
                # immediately return to the 63-node stress state.
                exercise_every = max(30, round(60 / sample_interval))
                if sample_index % exercise_every == 0:
                    page.evaluate("window.__HAN_TEST_API__.setSetting('muted', true)")
                    page.evaluate("window.__HAN_TEST_API__.setSetting('muted', false)")
                    page.evaluate("duration => window.__HAN_TEST_API__.wakeAll(duration)", (duration + 90) * 1000)
                next_sample += sample_interval

            final_state = state(page)
            page.evaluate("window.__HAN_TEST_API__.stop()")
            context.close()
            browser.close()
            browser = None

        stable_samples = samples[2:] if len(samples) > 4 else samples
        fps_values = [sample["fps"] for sample in stable_samples if sample["fps"] > 0]
        heaps = [sample["heapBytes"] for sample in stable_samples if sample["heapBytes"] is not None]
        heap_growth = heaps[-1] - heaps[0] if len(heaps) >= 2 else None
        average_fps = sum(fps_values) / len(fps_values) if fps_values else None
        sorted_fps = sorted(fps_values)
        median_fps = sorted_fps[len(sorted_fps) // 2] if sorted_fps else None
        low_fps_samples = sum(value < min_fps for value in fps_values)
        allowed_low_samples = max(3, int(len(fps_values) * .05 + .999))
        tail_average = sum(fps_values[-min(5, len(fps_values)):]) / min(5, len(fps_values)) if fps_values else None
        failures: list[str] = []
        if not samples:
            failures.append("no samples collected")
        if any(sample["rendererDrawn"] != 63 for sample in samples):
            failures.append("renderer failed to draw 63 nodes")
        if any(sample["activeCount"] != 63 for sample in samples):
            failures.append("63-node force-wake was not sustained")
        if any(sample["runtimeErrors"] for sample in samples):
            failures.append("runtimeErrors were reported")
        if average_fps is not None and average_fps < min_fps:
            failures.append(f"average FPS {average_fps:.2f} below {min_fps:.2f}")
        if median_fps is not None and median_fps < min_fps:
            failures.append(f"median FPS {median_fps:.2f} below {min_fps:.2f}")
        if low_fps_samples > allowed_low_samples:
            failures.append(f"{low_fps_samples} low-FPS samples exceed allowance {allowed_low_samples}")
        if tail_average is not None and tail_average < min_fps:
            failures.append(f"tail average FPS {tail_average:.2f} below {min_fps:.2f}")
        if heap_growth is not None and heap_growth > max_heap_growth:
            failures.append(f"heap growth {heap_growth} exceeds {max_heap_growth}")
        if errors:
            failures.append("console/page errors occurred")
        if external:
            failures.append("external network requests occurred")

        payload = {
            "ok": not failures,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "configuredDurationSeconds": duration,
            "actualDurationSeconds": round(time.monotonic() - started, 3),
            "sampleIntervalSeconds": sample_interval,
            "sampleCount": len(samples),
            "platform": platform.platform(),
            "python": sys.version,
            "browserExecutable": browser_path,
            "health": health,
            "thresholds": {"minimumFps": min_fps, "maximumHeapGrowthBytes": max_heap_growth},
            "metrics": {
                "minimumFps": min(fps_values) if fps_values else None,
                "averageFps": average_fps,
                "medianFps": median_fps,
                "tailAverageFps": tail_average,
                "lowFpsSamples": low_fps_samples,
                "allowedLowFpsSamples": allowed_low_samples,
                "heapGrowthBytes": heap_growth,
            },
            "failures": failures,
            "consoleErrors": errors,
            "warnings": warnings,
            "externalRequests": external,
            "samples": samples,
            "finalState": final_state,
        }
        result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            f"SOAK {'PASSED' if payload['ok'] else 'FAILED'}: configured {duration}s, "
            f"{len(samples)} samples, result {result_path}",
            flush=True,
        )
        return 0 if payload["ok"] else 1
    except Exception as error:  # noqa: BLE001
        payload = {
            "ok": False,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "configuredDurationSeconds": duration,
            "actualDurationSeconds": round(time.monotonic() - started, 3),
            "browserExecutable": browser_path,
            "failure": f"{type(error).__name__}: {error}",
            "samples": samples,
            "consoleErrors": errors,
            "externalRequests": external,
        }
        result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"SOAK FAILED: {payload['failure']} (result {result_path})", file=sys.stderr, flush=True)
        return 1
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
