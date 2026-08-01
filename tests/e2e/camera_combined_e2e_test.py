#!/usr/bin/env python3
"""Combined camera behavior suite in one Chromium process.

The project still ships each camera scenario as an independently runnable test,
but the default runner combines them to avoid repeated headless-Chromium startup
pathologies observed after a fourth rapid browser launch in constrained CI.
"""
from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import asdict

from playwright.sync_api import sync_playwright

from camera_e2e_test import run_camera
from camera_race_e2e_test import run_race
from reconnect_e2e_test import run_reconnect
from e2e_test import (
    CHECKS,
    RESULTS_DIR,
    ROOT,
    check,
    choose_port,
    find_browser,
    install_observers,
    state,
    wait_health,
)


def run_context(browser, base_url: str, runner, errors: list[str], warnings: list[str], external: list[str], viewport: dict) -> dict:
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    install_observers(page, base_url, errors, warnings, external)
    result = runner(page, base_url)
    final_state = state(page)
    check(f"{runner.__name__} renderer remains alive", final_state["rendererDrawn"] == 63, final_state["rendererDrawn"])
    page.evaluate("window.__HAN_TEST_API__.stop()")
    context.close()
    return {"result": result, "finalState": final_state}


def main() -> int:
    CHECKS.clear()
    started = time.monotonic()
    port = choose_port()
    base_url = f"http://127.0.0.1:{port}"
    log_path = RESULTS_DIR / "camera-combined-e2e-server.log"
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
    browser_path = None
    browser = None
    try:
        health = wait_health(base_url)
        check("combined camera health endpoint", health.get("ok") is True, health)
        with sync_playwright() as playwright:
            browser_path = find_browser(playwright)
            args = ["--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info"]
            if platform.system().lower() == "linux":
                args.extend(["--no-sandbox", "--disable-dev-shm-usage"])
            browser = playwright.chromium.launch(headless=True, executable_path=browser_path, args=args)
            race = run_context(browser, base_url, run_race, errors, warnings, external, {"width": 1100, "height": 700})
            camera = run_context(browser, base_url, run_camera, errors, warnings, external, {"width": 1280, "height": 800})
            reconnect = run_context(browser, base_url, run_reconnect, errors, warnings, external, {"width": 960, "height": 600})
            browser.close()
            browser = None

        check("combined camera suite has no external requests", not external, external)
        check("combined camera suite has no console/page errors", not errors, errors)
        report = {
            "ok": True,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationSeconds": round(time.monotonic() - started, 3),
            "platform": platform.platform(),
            "python": sys.version,
            "browserExecutable": browser_path,
            "health": health,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "race": race,
            "camera": camera,
            "reconnect": reconnect,
        }
        (RESULTS_DIR / "camera-combined-e2e-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"COMBINED CAMERA E2E PASSED: {len(CHECKS)} checks in {report['durationSeconds']}s")
        return 0
    except Exception as error:  # noqa: BLE001
        report = {
            "ok": False,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationSeconds": round(time.monotonic() - started, 3),
            "browserExecutable": browser_path,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "failure": f"{type(error).__name__}: {error}",
        }
        (RESULTS_DIR / "camera-combined-e2e-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"COMBINED CAMERA E2E FAILED: {report['failure']}", file=sys.stderr)
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
