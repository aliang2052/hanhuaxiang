#!/usr/bin/env python3
"""Browser-level hardware -> simulated -> hardware race regression test."""
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


def run_race(page, base_url: str) -> dict:
    page.goto(base_url, wait_until="networkidle")
    wait_for(page, "() => window.__HAN_TEST_API__?.getState().ready === true", 20_000)
    page.click("#enterButton")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().entered === true")
    page.evaluate("window.__HAN_TEST_API__.setMode('camera')")
    page.evaluate(
        """() => {
          const video = document.getElementById('cameraVideo');
          Object.defineProperty(video, 'readyState', {configurable: true, get: () => 4});
          Object.defineProperty(video, 'videoWidth', {configurable: true, get: () => 640});
          Object.defineProperty(video, 'videoHeight', {configurable: true, get: () => 360});
          video.play = async () => undefined;
          const makeStream = label => {
            const canvas = document.createElement('canvas');
            canvas.width = 64; canvas.height = 36;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = label === 'old' ? '#111' : '#eee';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const stream = canvas.captureStream(5);
            stream.__label = label;
            return stream;
          };
          const oldStream = makeStream('old');
          const newStream = makeStream('new');
          const requests = [];
          navigator.mediaDevices.getUserMedia = () => new Promise((resolve, reject) => requests.push({resolve, reject}));
          window.__cameraRace = {requests, oldStream, newStream};
          window.__oldHardwareSwitch = window.__HAN_TEST_API__.setCameraSource('hardware');
        }"""
    )
    wait_for(page, "() => window.__cameraRace.requests.length === 1")
    first_snapshot = state(page)["camera"]
    check("first hardware request is pending", first_snapshot["getUserMediaCalls"] == 1, first_snapshot)

    simulated = page.evaluate("window.__HAN_TEST_API__.setCameraSource('simulated')")
    check("intermediate simulated source starts", simulated is True, simulated)
    wait_for(page, "() => window.__HAN_TEST_API__.getState().camera.source === 'simulated'")

    page.evaluate("() => { window.__newHardwareSwitch = window.__HAN_TEST_API__.setCameraSource('hardware'); }")
    wait_for(page, "() => window.__cameraRace.requests.length === 2")
    wait_for(
        page,
        "() => window.__HAN_TEST_API__.getState().camera.source === 'hardware' && window.__HAN_TEST_API__.getState().camera.getUserMediaCalls === 2",
    )
    second_snapshot = state(page)["camera"]
    check("second hardware selection starts a new request", second_snapshot["getUserMediaCalls"] == 2, second_snapshot)

    page.evaluate("window.__cameraRace.requests[0].resolve(window.__cameraRace.oldStream)")
    old_result = page.evaluate("window.__oldHardwareSwitch")
    check("stale first hardware request resolves false", old_result is False, old_result)
    wait_for(page, "() => window.__cameraRace.oldStream.getVideoTracks()[0].readyState === 'ended'")

    page.evaluate("window.__cameraRace.requests[1].resolve(window.__cameraRace.newStream)")
    new_result = page.evaluate("window.__newHardwareSwitch")
    check("current second hardware request resolves true", new_result is True, new_result)
    wait_for(
        page,
        "() => window.__HAN_TEST_API__.getState().camera.source === 'hardware' && window.__HAN_TEST_API__.getState().camera.transportState === 'live'",
        8_000,
    )
    final = state(page)
    stream_identity = page.evaluate(
        """() => ({
          currentIsNew: document.getElementById('cameraVideo').srcObject === window.__cameraRace.newStream,
          oldTrack: window.__cameraRace.oldStream.getVideoTracks()[0].readyState,
          newTrack: window.__cameraRace.newStream.getVideoTracks()[0].readyState,
        })"""
    )
    check(
        "old stream is stopped and cannot pollute the current video",
        stream_identity["currentIsNew"] and stream_identity["oldTrack"] == "ended" and stream_identity["newTrack"] == "live",
        stream_identity,
    )
    check(
        "rapid source race leaves one live hardware session and renderer alive",
        final["camera"]["source"] == "hardware"
        and final["camera"]["getUserMediaCalls"] == 2
        and final["rendererDrawn"] == 63
        and not final["runtimeErrors"],
        {"camera": final["camera"], "drawn": final["rendererDrawn"]},
    )
    return {"final": final, "streamIdentity": stream_identity}


def main() -> int:
    CHECKS.clear()
    started = time.monotonic()
    port = choose_port()
    base_url = f"http://127.0.0.1:{port}"
    log_path = RESULTS_DIR / "camera-race-e2e-server.log"
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
    try:
        health = wait_health(base_url)
        check("camera race health endpoint", health.get("ok") is True, health)
        with sync_playwright() as playwright:
            browser_path = find_browser(playwright)
            args = ["--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info"]
            if platform.system().lower() == "linux":
                args.extend(["--no-sandbox", "--disable-dev-shm-usage"])
            browser = playwright.chromium.launch(headless=True, executable_path=browser_path, args=args)
            try:
                context = browser.new_context(viewport={"width": 1100, "height": 700})
                page = context.new_page()
                install_observers(page, base_url, errors, warnings, external)
                race = run_race(page, base_url)
                check("camera race has no external requests", not external, external)
                check("camera race has no console/page errors", not errors, errors)
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
            "health": health,
            "checks": [asdict(item) for item in CHECKS],
            "warnings": warnings,
            "consoleErrors": errors,
            "externalRequests": external,
            "race": race,
        }
        (RESULTS_DIR / "camera-race-e2e-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"CAMERA RACE E2E PASSED: {len(CHECKS)} checks in {report['durationSeconds']}s")
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
        (RESULTS_DIR / "camera-race-e2e-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"CAMERA RACE E2E FAILED: {report['failure']}", file=sys.stderr)
        return 1
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
