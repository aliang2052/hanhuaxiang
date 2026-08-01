#!/usr/bin/env python3
"""Offline smoke test for the Han Orchestra web installation.

The CAAS Chromium policy blocks normal navigation, so this test loads index.html
into about:blank and intercepts the app's local requests. Runtime behaviour is
otherwise the same as serving the project over localhost.
"""
from __future__ import annotations

import json
import mimetypes
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)


def route_local(route) -> None:
    url = route.request.url
    prefix = "http://han.local/"
    rel = url.split(prefix, 1)[-1].split("?", 1)[0]
    path = (ROOT / (rel or "index.html")).resolve()
    if not str(path).startswith(str(ROOT.resolve())) or not path.is_file():
        route.fulfill(status=404, body="not found")
        return
    route.fulfill(
        status=200,
        content_type=mimetypes.guess_type(str(path))[0] or "application/octet-stream",
        body=path.read_bytes(),
    )


def load_page(browser, width: int = 1600, height: int = 900):
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
    requests: list[str] = []
    errors: list[str] = []
    warnings: list[str] = []
    page.route("http://han.local/**", route_local)
    page.on("request", lambda req: requests.append(req.url))
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on(
        "console",
        lambda msg: errors.append(msg.text)
        if msg.type == "error"
        else warnings.append(msg.text)
        if msg.type == "warning"
        else None,
    )
    index = (ROOT / "index.html").read_text(encoding="utf-8").replace(
        "<head>", '<head><base href="http://han.local/">', 1
    )
    page.set_content(index, wait_until="load", timeout=120_000)
    page.wait_for_function("window.__HAN_APP__ && window.__HAN_APP__.getState().ready", timeout=120_000)
    return page, requests, errors, warnings


def main() -> int:
    report: dict[str, object] = {"checks": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path="/usr/bin/chromium",
            args=["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
        )

        page, requests, errors, warnings = load_page(browser)
        initial = page.evaluate("window.__HAN_APP__.getState()")
        assert initial["ready"] is True
        assert initial["cellCount"] == 63
        report["checks"]["load_63_cells"] = initial

        # A real click provides the AudioContext user gesture.
        page.click("#enterButton")
        page.wait_for_function("window.__HAN_APP__.getState().audioReady", timeout=30_000)
        page.wait_for_timeout(5_500)
        auto = page.evaluate("window.__HAN_APP__.getState()")
        assert auto["running"] is True
        assert 0 < auto["activeCount"] < 63
        assert auto["fps"] > 20, auto
        report["checks"]["auto_demo_audio_and_fps"] = auto
        page.screenshot(path=str(DOCS / "preview-auto.png"), full_page=True)

        # One synthetic visitor should wake a local cluster, not every cell.
        page.evaluate("window.__HAN_APP__.setPointerPeople([{x:.34,y:.55,rx:.10,ry:.30}])")
        page.wait_for_timeout(1_800)
        pointer = page.evaluate("window.__HAN_APP__.getState()")
        assert 3 <= pointer["activeCount"] < 35, pointer
        report["checks"]["pointer_person_cluster"] = pointer
        page.screenshot(path=str(DOCS / "preview-pointer.png"), full_page=True)

        # Full orchestra test.
        page.evaluate("window.__HAN_APP__.wakeAll(5000)")
        page.wait_for_function("window.__HAN_APP__.getState().activeCount === 63", timeout=10_000)
        page.wait_for_timeout(800)
        full = page.evaluate("window.__HAN_APP__.getState()")
        assert full["activeCount"] == 63
        report["checks"]["wake_all_63"] = full
        page.screenshot(path=str(DOCS / "preview-all.png"), full_page=True)

        page.evaluate("window.__HAN_APP__.openDebug()")
        page.wait_for_timeout(400)
        assert page.locator("#debugView").is_visible()
        page.screenshot(path=str(DOCS / "preview-calibration.png"), full_page=True)
        page.evaluate("window.__HAN_APP__.closeDebug()")
        report["checks"]["calibration_panel"] = "visible and closable"

        # No runtime request may leave the bundled origin.
        external = [u for u in requests if not u.startswith("http://han.local/")]
        assert external == [], external
        assert errors == [], errors
        app_errors = page.evaluate("window.__HAN_APP__.getState().errors")
        assert app_errors == [], app_errors
        report["checks"]["offline_requests"] = {"requestCount": len(requests), "external": external}
        report["checks"]["console"] = {"errors": errors, "warnings": warnings}

        # Portrait layout smoke test: interaction and UI must still load without errors.
        mobile, _, mobile_errors, _ = load_page(browser, 390, 844)
        mobile.evaluate("window.__HAN_APP__.start()")
        mobile.wait_for_timeout(1_500)
        mobile_state = mobile.evaluate("window.__HAN_APP__.getState()")
        assert mobile_state["ready"] and mobile_state["running"]
        assert mobile_errors == [], mobile_errors
        mobile.screenshot(path=str(DOCS / "preview-mobile.png"), full_page=True)
        report["checks"]["mobile_390x844"] = mobile_state

        browser.close()

    (DOCS / "smoke-test-results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SMOKE TEST FAILED: {exc}", file=sys.stderr)
        raise
