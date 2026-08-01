#!/usr/bin/env python3
"""Allow Chromium/Playwright child processes to release OS resources between phases."""
import os
import time

seconds = max(0.0, float(os.environ.get("E2E_COOLDOWN_SECONDS", "8")))
if seconds:
    print(f"E2E cooldown: {seconds:g}s", flush=True)
    time.sleep(seconds)
