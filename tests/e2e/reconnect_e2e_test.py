#!/usr/bin/env python3
"""Fresh-process simulated-camera disconnect/reconnect E2E.

A separate Chromium/Playwright process is deliberate: it verifies the camera
state machine without retaining the real-time foreground loop used by the
segmentation behavior suite.
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

from e2e_test import (
    CHECKS,
    RESULTS_DIR,
    ROOT,
    check,
    choose_port,
    find_browser,
    install_observers,
    state,
    wait_for,
    wait_health,
)


def run_reconnect(page, base_url: str) -> dict:
    page.goto(base_url, wait_until="networkidle")
    wait_for(page, "() => window.__HAN_TEST_API__?.getState().ready === true", 20_000)
    page.click("#enterButton")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().entered === true")

    page.evaluate("window.__HAN_TEST_API__.setCameraSource('simulated')")
    page.evaluate("window.__HAN_TEST_API__.setSimulatedScenario('empty')")
    page.evaluate("window.__HAN_TEST_API__.setMode('camera')")
    started = page.evaluate("window.__HAN_TEST_API__.startCamera()")
    check("simulated camera starts for reconnect test", started is True, started)
    wait_for(page, "() => window.__HAN_TEST_API__.getState().camera.state === 'live'", 4_000)
    before = state(page)

    disconnected = page.evaluate("window.__HAN_TEST_API__.simulateDisconnect()")
    check("simulated disconnect request is accepted", disconnected is True, disconnected)
    wait_for(
        page,
        "() => ['disconnected','reconnecting'].includes(window.__HAN_TEST_API__.getState().camera.state)",
        2_000,
    )
    during = state(page)
    check(
        "camera enters disconnected or reconnecting state",
        during["camera"]["state"] in {"disconnected", "reconnecting"},
        during["camera"],
    )
    wait_for(page, "() => window.__HAN_TEST_API__.getState().camera.state === 'live'", 5_000)
    recovered = state(page)
    check(
        "simulated camera reconnects without page crash",
        recovered["camera"]["state"] == "live"
        and recovered["camera"]["reconnectAttempts"] >= 1
        and not recovered["runtimeErrors"],
        recovered["camera"],
    )
    return {"before": before, "during": during, "recovered": recovered}


def main() -> int:
    CHECKS.clear()
    started_at = time.monotonic()
    port = choose_port()
    base_url = f"http://127.0.0.1:{port}"
    log_path = RESULTS_DIR / "reconnect-e2e-server.log"
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
        check("reconnect E2E health endpoint", health.get("ok") is True, health)
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
                context = browser.new_context(viewport={"width": 960, "height": 600})
                page = context.new_page()
                install_observers(page, base_url, errors, warnings, external)
                reconnect = run_reconnect(page, base_url)
                final_state = state(page)
                check("reconnect phase has no external requests", not external, external)
                check("reconnect phase has no console/page errors", not errors, errors)
                check("reconnect phase renderer remains alive", final_state["rendererDrawn"] == 63, final_state["rendererDrawn"])
                page.evaluate("window.__HAN_TEST_API__.stop()")
                context.close()
            finally:
                browser.close()

        report = {
            "ok": True,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationSeconds": round(time.monotonic() - started_at, 3),
            "platform": platform.platform(),
            "python": sys.version,
            "browserExecutable": browser_path,
            "baseUrl": base_url,
            "health": health,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "reconnect": reconnect,
            "finalState": final_state,
        }
        (RESULTS_DIR / "reconnect-e2e-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"RECONNECT E2E PASSED: {len(CHECKS)} behavioral checks in {report['durationSeconds']}s")
        return 0
    except Exception as error:  # noqa: BLE001
        report = {
            "ok": False,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationSeconds": round(time.monotonic() - started_at, 3),
            "browserExecutable": browser_path,
            "baseUrl": base_url,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "failure": f"{type(error).__name__}: {error}",
        }
        (RESULTS_DIR / "reconnect-e2e-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"RECONNECT E2E FAILED: {report['failure']}", file=sys.stderr)
        return 1
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
