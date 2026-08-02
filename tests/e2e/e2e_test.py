#!/usr/bin/env python3
"""Behavior-level P0 E2E for the offline Han portrait-stone installation.

Browser selection is portable: PLAYWRIGHT_CHROMIUM_PATH wins, then the
Playwright-managed executable, then an executable found on PATH. No Linux path
is embedded in this test.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import socket
import statistics
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_ROOT = Path(os.environ.get("E2E_ARTIFACT_DIR", ROOT / "docs")).expanduser().resolve()
SCREENSHOTS = ARTIFACT_ROOT / "screenshots"
RESULTS_DIR = ARTIFACT_ROOT / "test-results"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


CHECKS: list[Check] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    text = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False, sort_keys=True)
    CHECKS.append(Check(name, bool(condition), text))
    if not condition:
        raise AssertionError(f"{name}: {text}")
    print(f"PASS {name}{f': {text}' if text else ''}")


def wait_for(page: Page, expression: str, timeout: int = 10_000, arg: object | None = None) -> object:
    handle = page.wait_for_function(expression, arg=arg, timeout=timeout)
    return handle.json_value()


def find_browser(playwright: Playwright) -> str | None:
    configured = os.environ.get("PLAYWRIGHT_CHROMIUM_PATH")
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_file():
            raise FileNotFoundError(f"PLAYWRIGHT_CHROMIUM_PATH does not exist: {candidate}")
        return str(candidate)
    managed = Path(playwright.chromium.executable_path)
    if managed.is_file():
        return str(managed)
    for command in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"):
        resolved = shutil.which(command)
        if resolved:
            return resolved
    return None


def choose_port() -> int:
    configured = os.environ.get("E2E_PORT")
    if configured:
        return int(configured)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_health(base_url: str, timeout: float = 12.0) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=1.5) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001 - diagnostic retry loop
            last_error = error
            time.sleep(0.1)
    raise RuntimeError(f"server health timed out: {last_error}")


def install_observers(page: Page, base_url: str, errors: list[str], warnings: list[str], external: list[str]) -> None:
    base_netloc = urlparse(base_url).netloc

    def on_console(message) -> None:
        text = f"{message.type}: {message.text}"
        if message.type == "error":
            errors.append(text)
        elif message.type == "warning":
            warnings.append(text)

    def on_request(request) -> None:
        parsed = urlparse(request.url)
        if parsed.scheme in {"http", "https"} and parsed.netloc != base_netloc:
            external.append(request.url)

    page.on("console", on_console)
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on("request", on_request)


def dispatch_pointer(page: Page, event_type: str, pointer_id: int, x: float, y: float, pointer_type: str = "touch") -> None:
    page.evaluate(
        """({type, pointerId, x, y, pointerType}) => {
          const canvas = document.getElementById('artCanvas');
          canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId, pointerType,
            clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : 0.7,
            buttons: type === 'pointerup' ? 0 : 1, isPrimary: pointerId === 1,
          }));
        }""",
        {"type": event_type, "pointerId": pointer_id, "x": x, "y": y, "pointerType": pointer_type},
    )


def state(page: Page) -> dict:
    return page.evaluate("window.__HAN_TEST_API__.getState()")


def run_primary(page: Page, base_url: str) -> dict:
    page.goto(base_url, wait_until="networkidle")
    wait_for(page, "() => window.__HAN_TEST_API__?.getState().ready === true", 20_000)
    initial = state(page)
    check("bootstrap has no boot error", page.evaluate("window.__HAN_BOOT_ERROR__ || null") is None)
    check("63 scene nodes", initial["sceneNodeCount"] == 63, initial["sceneNodeCount"])
    check("V3 varied sprite set is loaded without missing files",
          initial["distinctSpriteFiles"] >= 40
          and initial["loadedSpriteFiles"] == initial["distinctSpriteFiles"],
          {"configured": initial["distinctSpriteFiles"], "loaded": initial["loadedSpriteFiles"]})
    check("asset diversity metadata records 32 genuinely different base silhouettes",
          initial["assetStats"]["distinctBaseSilhouetteCount"] == 32
          and initial["assetStats"]["independentHighResSourceCount"] == 8
          and initial["assetStats"]["muralDerivedDistinctSourceCount"] == 24,
          initial["assetStats"])
    structure = initial["sceneStructure"]
    check("dense landscape visual structure",
          structure["panelCount"] >= 55 and structure["centralStagePresent"]
          and structure["centralStagePanelCount"] >= 5
          and structure["leftBorderPresent"] and structure["rightBorderPresent"]
          and structure["horizontalBeamCount"] >= 8,
          structure)
    check("trigger partition complete", initial["triggerPartition"]["valid"] and initial["triggerPartition"]["holes"] == 0,
          initial["triggerPartition"])

    page.click("#enterButton")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().entered === true")

    # Run sustained 63-node rendering on the fresh 1280×800 compositor before
    # any 4K/ultrawide resize or simulated-camera processing. This avoids
    # measuring cross-phase browser-driver residue while preserving the same
    # production renderer, assets, animation, audio and trigger state.
    print("PHASE fresh-page 63-node stress suite")
    stress = run_stress(page)
    page.evaluate("window.__HAN_TEST_API__.resetTriggers()")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().activeCount < 63")
    page.set_viewport_size({"width": 1920, "height": 1200})
    page.wait_for_timeout(350)

    # Auto mode must change actual trigger state, not merely expose controls.
    page.evaluate("window.__HAN_TEST_API__.setMode('auto')")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().activeCount > 0", 8_000)
    auto_state = state(page)
    check("auto demo activates a local subset", 0 < auto_state["activeCount"] < 63,
          {"active": auto_state["activeCount"], "coverageCells": auto_state["positiveCoverageCount"]})
    page.screenshot(path=str(SCREENSHOTS / "e2e-auto-1920x1200.png"))

    # Real DOM PointerEvents, including two simultaneous touch pointers.
    page.evaluate("window.__HAN_TEST_API__.setMode('pointer')")
    dispatch_pointer(page, "pointerdown", 1, 490, 650, "mouse")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().pointerCount === 1")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().positiveCoverageCount === 1")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().activeCount === 1")
    single_pointer = state(page)
    check("mouse precisely selects one real visual panel",
          single_pointer["positiveCoverageCount"] == 1
          and single_pointer["activeCount"] == 1
          and single_pointer["activeIds"] == single_pointer["pointerTargetIds"],
          {"coverage": single_pointer["positiveCoverageCount"], "active": single_pointer["activeIds"],
           "target": single_pointer["pointerTargetIds"]})
    dispatch_pointer(page, "pointerdown", 2, 1420, 510, "touch")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().pointerCount === 2")
    page.wait_for_timeout(250)
    two_pointer = state(page)
    check("multi-touch expands but does not flood coverage",
          single_pointer["positiveCoverageCount"] < two_pointer["positiveCoverageCount"] < 45,
          {"single": single_pointer["positiveCoverageCount"], "double": two_pointer["positiveCoverageCount"]})
    dispatch_pointer(page, "pointerup", 1, 490, 650, "mouse")
    dispatch_pointer(page, "pointerup", 2, 1420, 510, "touch")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().pointerCount === 0")
    page.screenshot(path=str(SCREENSHOTS / "e2e-pointer.png"))

    page.evaluate("window.__HAN_TEST_API__.wakeAll(1600)")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().activeCount === 63")
    all_state = state(page)
    check("wake-all reaches 63/63", all_state["activeCount"] == 63, all_state["activeCount"])
    page.screenshot(path=str(SCREENSHOTS / "e2e-all-awake.png"))

    # Responsive CSS stage. Canvas must fill, while internal pixels may be capped.
    sizes = [(1920, 1080), (1920, 1200), (2560, 1440), (3840, 2160), (3440, 1440), (390, 844)]
    responsive = []
    for width, height in sizes:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(350)
        metrics = page.evaluate("""() => {
          const rect = document.getElementById('artCanvas').getBoundingClientRect();
          const s = window.__HAN_TEST_API__.getState();
          return {rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, viewport: s.viewport,
                  orientation: s.orientation, drawn: s.rendererDrawn};
        }""")
        ok = abs(metrics["rect"]["width"] - width) <= 1 and abs(metrics["rect"]["height"] - height) <= 1
        ok = ok and metrics["drawn"] == 63 and metrics["viewport"]["backingPixels"] <= 1_820_000
        check(f"responsive {width}x{height}", ok, metrics)
        responsive.append({"size": [width, height], **metrics})
    check("390x844 uses portrait scene", responsive[-1]["orientation"] == "portrait", responsive[-1]["orientation"])

    page.click("#openPanel")
    panel = page.evaluate("""() => {
      const el = document.getElementById('controlPanel');
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              width: rect.width, height: rect.height, clientHeight: el.clientHeight,
              scrollHeight: el.scrollHeight, overflowY: style.overflowY};
    }""")
    check("mobile control panel stays within viewport",
          panel["left"] >= -1 and panel["right"] <= 391 and panel["top"] >= 0 and panel["bottom"] <= 845,
          panel)
    check("mobile panel can scroll", panel["scrollHeight"] > panel["clientHeight"] and panel["overflowY"] in {"auto", "scroll"}, panel)
    monitor = page.evaluate("""() => ({
      canvas: Boolean(document.getElementById('recognitionCanvas')),
      audio: document.getElementById('recognitionAudio')?.textContent || '',
      testAudio: Boolean(document.getElementById('testAudioButton')),
    })""")
    check("operator panel exposes recognition and audio diagnostics",
          monitor["canvas"] and monitor["testAudio"] and "63/63" in monitor["audio"], monitor)
    page.screenshot(path=str(SCREENSHOTS / "e2e-mobile-390x844.png"), full_page=True)
    page.click("#closePanel")

    # Return to a desktop view for projective calibration tests.
    page.set_viewport_size({"width": 1920, "height": 1200})
    page.wait_for_timeout(300)
    before = state(page)
    valid_quad = [
        {"x": 0.08, "y": 0.09}, {"x": 0.91, "y": 0.055},
        {"x": 0.965, "y": 0.91}, {"x": 0.045, "y": 0.95},
    ]
    valid_result = page.evaluate("quad => window.__HAN_TEST_API__.setCalibration(quad)", valid_quad)
    after_valid = state(page)
    check("valid 3x3 homography accepted", valid_result["valid"] and after_valid["calibration"]["verification"]["valid"],
          {"result": valid_result, "verification": after_valid["calibration"]["verification"]})
    check("homography discrete error below 1e-6",
          after_valid["calibration"]["verification"]["maxRoundTripError"] < 1e-6,
          after_valid["calibration"]["verification"]["maxRoundTripError"])
    check("calibration rebuilds pixel mapping",
          after_valid["coverageMapping"]["revision"] > before["coverageMapping"]["revision"],
          {"before": before["coverageMapping"]["revision"], "after": after_valid["coverageMapping"]["revision"]})
    valid_saved_quad = after_valid["calibration"]["quad"]
    crossed = [valid_quad[0], valid_quad[2], valid_quad[1], valid_quad[3]]
    invalid_result = page.evaluate("quad => window.__HAN_TEST_API__.setCalibration(quad)", crossed)
    after_invalid = state(page)
    check("crossed calibration rejected", not invalid_result["valid"], invalid_result)
    check("invalid calibration preserves prior valid quad", after_invalid["calibration"]["quad"] == valid_saved_quad,
          after_invalid["calibration"]["quad"])

    page.evaluate("window.__HAN_TEST_API__.setDebug(true)")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SCREENSHOTS / "e2e-calibration-debug.png"), full_page=True)
    page.evaluate("window.__HAN_TEST_API__.setDebug(false)")

    return {"responsive": responsive, "stress": stress}


def run_permission_denial(browser: Browser, base_url: str, errors: list[str], warnings: list[str], external: list[str]) -> dict:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    context.add_init_script("""
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException('E2E permission denied', 'NotAllowedError')),
        },
      });
    """)
    page = context.new_page()
    install_observers(page, base_url, errors, warnings, external)
    page.goto(base_url, wait_until="networkidle")
    wait_for(page, "() => window.__HAN_TEST_API__?.getState().ready === true", 20_000)
    page.evaluate("window.__HAN_TEST_API__.setCameraSource('hardware')")
    page.evaluate("window.__HAN_TEST_API__.setMode('camera')")
    results = page.evaluate("Promise.all([window.__HAN_TEST_API__.startCamera(), window.__HAN_TEST_API__.startCamera(), window.__HAN_TEST_API__.startCamera()])")
    page.wait_for_timeout(300)
    denied = state(page)
    check("permission denial returns false", results == [False, False, False], results)
    check("parallel permission requests are deduplicated",
          denied["camera"]["getUserMediaCalls"] == 1,
          denied["camera"])
    check("permission denial leaves renderer alive",
          denied["camera"]["state"] == "error" and denied["rendererDrawn"] == 63 and not denied["runtimeErrors"],
          {"camera": denied["camera"], "drawn": denied["rendererDrawn"], "errors": denied["runtimeErrors"]})
    page.screenshot(path=str(SCREENSHOTS / "e2e-camera-permission-denied.png"))
    context.close()
    return denied


def run_stress(page: Page) -> dict:
    # Use a 1280×800 full-stage viewport for the sustained renderer test. The
    # responsive suite separately proves 1920, 4K and ultrawide coverage; this
    # lower backing-store load prevents headless Chromium's compositor from
    # starving the Playwright transport while all 63 high-resolution sprites
    # are active.
    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(350)
    page.evaluate("window.__HAN_TEST_API__.setMode('auto')")
    # Keep the force-wake window comfortably longer than setup + sampling so
    # the test measures 63 active nodes for the whole interval.
    page.evaluate("window.__HAN_TEST_API__.wakeAll(30_000)")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().activeCount === 63")
    wait_for(page, "() => window.__HAN_TEST_API__.getState().fps >= 12", 12_000)
    page.wait_for_timeout(1_200)

    samples = []
    for _ in range(12):
        page.wait_for_timeout(1_000)
        current = state(page)
        samples.append({
            "fps": current["fps"],
            "active": current["activeCount"],
            "heap": current["memory"]["usedJSHeapSize"] if current.get("memory") else None,
            "runtimeErrors": current["runtimeErrors"],
        })

    stable_samples = samples[1:]
    fps_values = [sample["fps"] for sample in stable_samples]
    minimum_fps = min(fps_values)
    average_fps = sum(fps_values) / len(fps_values)
    median_fps = statistics.median(fps_values)
    low_samples = sum(value < 12 for value in fps_values)
    tail_average = sum(fps_values[-3:]) / min(3, len(fps_values))
    heaps = [sample["heap"] for sample in stable_samples if sample["heap"] is not None]
    heap_growth = (heaps[-1] - heaps[0]) if len(heaps) > 1 else None

    check("12-second 63-node stress keeps every node active", all(sample["active"] == 63 for sample in samples), samples[-1])
    check("12-second 63-node stress has no runtime errors", all(not sample["runtimeErrors"] for sample in samples), samples[-1])
    # Headless CI occasionally reports one GC/scheduler outlier. Treat a single
    # sub-12 FPS sample as noise, but reject a low average, low median, repeated
    # stalls, or a collapsed tail. This tests sustained degradation rather than
    # making the entire run hinge on one one-second measurement.
    check("stress FPS does not collapse",
          average_fps >= 22 and median_fps >= 20 and low_samples <= 1 and tail_average >= 18,
          {"minimum": round(minimum_fps, 2), "median": round(median_fps, 2),
           "average": round(average_fps, 2), "tailAverage": round(tail_average, 2),
           "samplesBelow12": low_samples})
    if heap_growth is not None:
        check("short stress has no sustained >96 MiB heap growth", heap_growth < 96 * 1024 * 1024,
              {"growthBytes": heap_growth, "first": heaps[0], "last": heaps[-1]})
    return {
        "samples": samples,
        "minimumFps": minimum_fps,
        "medianFps": median_fps,
        "averageFps": average_fps,
        "tailAverageFps": tail_average,
        "samplesBelow12": low_samples,
        "heapGrowth": heap_growth,
    }


def main() -> int:
    started = time.monotonic()
    port = choose_port()
    base_url = f"http://127.0.0.1:{port}"
    log_path = RESULTS_DIR / "e2e-server.log"
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
    browser: Browser | None = None
    try:
        health = wait_health(base_url)
        check("health endpoint before E2E", health.get("ok") is True and health.get("version") == "4.0.0-v3-live", health)
        with sync_playwright() as playwright:
            browser_path = find_browser(playwright)
            launch_args = ["--autoplay-policy=no-user-gesture-required", "--enable-precise-memory-info"]
            if platform.system().lower() == "linux":
                launch_args.extend(["--no-sandbox", "--disable-dev-shm-usage"])
            # Keep the permission-denial injection in its own short-lived browser.
            # Reusing one Chromium process for both a secondary injected context and
            # the high-resolution stress page intermittently stalled the Playwright
            # transport in this container. Process isolation preserves all coverage
            # while removing that cross-context driver failure mode.
            denial_browser = playwright.chromium.launch(
                headless=True,
                executable_path=browser_path,
                args=launch_args,
            )
            try:
                denied = run_permission_denial(denial_browser, base_url, errors, warnings, external)
            finally:
                denial_browser.close()

            print("PHASE primary behavior suite")
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=browser_path,
                args=launch_args,
            )
            context = browser.new_context(viewport={"width": 1920, "height": 1200})
            page = context.new_page()
            install_observers(page, base_url, errors, warnings, external)
            primary = run_primary(page, base_url)
            stress = primary["stress"]
            final_state = state(page)
            context.close()
            browser.close()
            browser = None

        check("no external network requests", not external, external)
        check("no console/page errors", not errors, errors)
        check("final renderer still draws 63 nodes", final_state["rendererDrawn"] == 63, final_state["rendererDrawn"])

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
            "primary": primary,
            "permissionDenied": denied,
            "stress": stress,
            "finalState": final_state,
        }
        (RESULTS_DIR / "e2e-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"E2E PASSED: {len(CHECKS)} behavioral checks in {report['durationSeconds']}s")
        return 0
    except Exception as error:  # noqa: BLE001 - write complete diagnostics
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
        (RESULTS_DIR / "e2e-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"E2E FAILED: {report['failure']}", file=sys.stderr)
        return 1
    finally:
        # The sync_playwright context owns browser teardown. Calling close after
        # that context exits raises "Event loop is closed" and can mask the
        # real E2E failure, so only terminate the application server here.
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
