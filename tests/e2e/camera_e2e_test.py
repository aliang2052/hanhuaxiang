#!/usr/bin/env python3
"""Isolated behavior-level simulated-camera E2E.

This phase runs in its own Python/Playwright process so a real-time segmentation
loop cannot retain renderer/compositor state from the responsive/stress suite.
Reconnect behavior is verified by a second fresh-process test.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import asdict

from playwright.sync_api import sync_playwright

from e2e_test import (
    CHECKS,
    RESULTS_DIR,
    ROOT,
    SCREENSHOTS,
    check,
    choose_port,
    find_browser,
    install_observers,
    state,
    wait_for,
    wait_health,
)


def run_camera(page, base_url: str) -> dict:
    page.goto(base_url, wait_until="networkidle")
    wait_for(page, "() => window.__HAN_TEST_API__?.getState().ready === true", 20_000)
    page.click("#enterButton")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().entered === true")
    page.set_viewport_size({"width": 640, "height": 400})
    page.wait_for_timeout(300)

    page.evaluate("window.__HAN_TEST_API__.setMode('auto')")
    page.evaluate("window.__HAN_TEST_API__.setCameraSource('simulated')")
    page.evaluate("window.__HAN_TEST_API__.setSimulatedScenario('empty')")
    capture_started = page.evaluate("window.__HAN_TEST_API__.captureBackground(8)")
    check("background capture auto-switches from auto to camera", capture_started is True, capture_started)
    wait_for(page, "() => window.__HAN_TEST_API__.getState().backgroundReady === true", 8_000)
    captured = state(page)
    check(
        "background capture completes in camera mode",
        captured["mode"] == "camera" and not captured["capturingBackground"],
        {"mode": captured["mode"], "ready": captured["backgroundReady"]},
    )

    page.evaluate("window.__HAN_TEST_API__.setSimulatedScenario('single')")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().componentCount >= 1", 8_000)
    page.click("#openPanel")
    wait_for(page, "() => Number(document.getElementById('recognitionPeople')?.textContent || 0) >= 1", 4_000)
    page.wait_for_timeout(450)
    single_camera = state(page)
    check(
        "simulated single person triggers locally",
        single_camera["componentCount"] == 1
        and 0 < single_camera["positiveCoverageCount"] < 32
        and 0 < single_camera["activeCount"] < 32,
        {
            "components": single_camera["componentCount"],
            "coverage": single_camera["positiveCoverageCount"],
            "active": single_camera["activeCount"],
        },
    )
    recognition = page.evaluate("""() => ({
      people: Number(document.getElementById('recognitionPeople').textContent),
      foreground: Number(document.getElementById('recognitionForeground').textContent),
      active: document.getElementById('recognitionActive').textContent,
      health: document.getElementById('recognitionHealth').textContent,
    })""")
    check("recognition monitor visualizes the detected foreground",
          recognition["people"] >= 1 and recognition["foreground"] > 0 and recognition["active"] != "0 / 63",
          recognition)

    page.wait_for_timeout(4_000)
    static_camera = state(page)
    check(
        "static person is not absorbed after four seconds",
        static_camera["componentCount"] >= 1,
        {"components": static_camera["componentCount"], "foreground": static_camera["foregroundPixels"]},
    )

    page.evaluate("window.__HAN_TEST_API__.setSimulatedScenario('double')")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().componentCount >= 2", 8_000)
    page.wait_for_timeout(450)
    double_camera = state(page)
    check(
        "simulated two-person coverage expands locally",
        double_camera["componentCount"] >= 2
        and double_camera["positiveCoverageCount"] > single_camera["positiveCoverageCount"]
        and double_camera["positiveCoverageCount"] < 52
        and 0 < double_camera["activeCount"] < 52,
        {
            "components": double_camera["componentCount"],
            "singleCoverage": single_camera["positiveCoverageCount"],
            "doubleCoverage": double_camera["positiveCoverageCount"],
            "active": double_camera["activeCount"],
        },
    )
    page.screenshot(path=str(SCREENSHOTS / "e2e-camera-simulated.png"))

    page.evaluate("window.__HAN_TEST_API__.setSimulatedScenario('light-shift')")
    page.wait_for_timeout(900)
    light_state = state(page)
    check(
        "global light shift is suppressed",
        light_state["componentCount"] == 0 and light_state["positiveCoverageCount"] == 0,
        {
            "components": light_state["componentCount"],
            "coverage": light_state["positiveCoverageCount"],
            "foreground": light_state["foregroundPixels"],
        },
    )

    return {
        "captured": captured,
        "single": single_camera,
        "static": static_camera,
        "double": double_camera,
        "light": light_state,
    }


def main() -> int:
    CHECKS.clear()
    started = time.monotonic()
    port = choose_port()
    base_url = f"http://127.0.0.1:{port}"
    log_path = RESULTS_DIR / "camera-e2e-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [shutil.which("node") or "node", "server.js", f"--port={port}"],
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
    errors: list[str] = []
    warnings: list[str] = []
    external: list[str] = []
    browser_path: str | None = None
    try:
        health = wait_health(base_url)
        check("camera E2E health endpoint", health.get("ok") is True, health)
        with sync_playwright() as playwright:
            browser_path = find_browser(playwright)
            launch_args = ["--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info"]
            if platform.system().lower() == "linux":
                launch_args.extend(["--no-sandbox", "--disable-dev-shm-usage"])
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=browser_path,
                args=launch_args,
            )
            try:
                context = browser.new_context(viewport={"width": 640, "height": 400})
                page = context.new_page()
                install_observers(page, base_url, errors, warnings, external)
                camera = run_camera(page, base_url)
                final_state = state(page)
                check("camera phase has no external requests", not external, external)
                check("camera phase has no console/page errors", not errors, errors)
                check("camera phase renderer remains alive", final_state["rendererDrawn"] == 63, final_state["rendererDrawn"])
                page.evaluate("window.__HAN_TEST_API__.stop()")
                context.close()
            finally:
                browser.close()

        report = {
            "ok": True,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationSeconds": round(time.monotonic() - started, 3),
            "platform": platform.platform(),
            "python": sys.version,
            "browserExecutable": browser_path,
            "baseUrl": base_url,
            "health": health,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "camera": camera,
            "finalState": final_state,
        }
        (RESULTS_DIR / "camera-e2e-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"CAMERA E2E PASSED: {len(CHECKS)} behavioral checks in {report['durationSeconds']}s")
        return 0
    except Exception as error:  # noqa: BLE001
        report = {
            "ok": False,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationSeconds": round(time.monotonic() - started, 3),
            "browserExecutable": browser_path,
            "baseUrl": base_url,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "failure": f"{type(error).__name__}: {error}",
        }
        (RESULTS_DIR / "camera-e2e-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"CAMERA E2E FAILED: {report['failure']}", file=sys.stderr)
        return 1
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
