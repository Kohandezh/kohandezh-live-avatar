"""Render recorded answer videos through the existing workbench chain.

Runs inside the orchestrator container (it calls the API on 127.0.0.1:8000).
Input:  /media/render/answers.json  [{"key": "Q001", "question": "...", "answer": "..."}]
Output: /media/render/results.json  one row per key: video_assets.id, status, duration, error.
Only keys without a finished row are rendered, so a rerun resumes after a failure.

Every route it calls needs an admin session, so it reads an admin bearer token from ADMIN_TOKEN
and stops before any request when it is empty. The token is sent only as a request header and
is never printed.

Usage: python render_answers.py [KEY ...]   (no keys = every pending key)
See apps/api/setup/server/README.md.
"""

import json
import os
import sys
import time
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000"
INPUT = Path(os.environ.get("RENDER_INPUT", "/media/render/answers.json"))
RESULTS = Path(os.environ.get("RENDER_RESULTS", "/media/render/results.json"))
RECORDER_WARMUP_SECONDS = 6  # Egress starts a headless browser that must join the room first.
TAIL_SECONDS = 1.5  # Let the last frame and audio reach the recorder before stopping.


def load_results() -> dict:
    return json.loads(RESULTS.read_text("utf-8")) if RESULTS.is_file() else {}


def save_results(results: dict) -> None:
    RESULTS.write_text(json.dumps(results, ensure_ascii=False, indent=2), "utf-8")


def check(response: httpx.Response) -> dict:
    if response.status_code >= 400:
        request = response.request
        raise RuntimeError(
            f"{request.method} {request.url.path} -> {response.status_code}: {response.text[:400]}"
        )
    return response.json()


def render_one(client: httpx.Client, item: dict) -> dict:
    session = check(client.post("/avatar/session", json={"sandbox": False, "max_session_duration": 300}))
    session_id = session["id"]
    started = time.time()
    try:
        external_id = f"ANS_{item['key']}_{time.strftime('%Y%m%d%H%M%S')}"
        recording = check(
            client.post(
                "/assets/generate-video",
                json={"session_id": session_id, "asset_id": external_id, "text": item["answer"]},
            )
        )
        time.sleep(RECORDER_WARMUP_SECONDS)
        spoken = check(client.post("/avatar/speak", json={"session_id": session_id, "text": item["answer"]}))
        time.sleep(TAIL_SECONDS)
        final = check(client.post(f"/assets/video/{recording['id']}/finalize"))
        return {
            **{k: v for k, v in item.items() if k not in ("answer",)},
            "answer": item["answer"],
            "video_asset_id": recording["id"],
            "external_id": external_id,
            "audio_asset_id": spoken.get("audio_asset_id"),
            "status": final["status"],
            "duration_ms": final.get("probe", {}).get("duration_ms"),
            "file": f"/media/video/{external_id}.mp4",
            "error": None,
        }
    finally:
        try:
            client.post("/avatar/close", json={"session_id": session_id})
        finally:
            print(f"  session closed after {time.time() - started:.0f}s", flush=True)


def main() -> None:
    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        sys.exit("ADMIN_TOKEN is empty: set it to an admin bearer token first (see README.md).")
    items = json.loads(INPUT.read_text("utf-8"))
    wanted = set(sys.argv[1:])
    results = load_results()
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(base_url=API, headers=headers, timeout=httpx.Timeout(300.0)) as client:
        for item in items:
            key = item["key"]
            if wanted and key not in wanted:
                continue
            if not wanted and results.get(key, {}).get("error") is None and key in results:
                continue
            print(f"{key}: rendering ({len(item['answer'])} chars)", flush=True)
            try:
                results[key] = render_one(client, item)
                print(f"{key}: {results[key]['status']} {results[key]['duration_ms']} ms", flush=True)
            except Exception as exc:  # keep going; the failed key is retried on the next run
                results[key] = {
                    "key": key,
                    "question": item["question"],
                    "answer": item["answer"],
                    "error": str(exc),
                }
                print(f"{key}: FAILED {exc}", flush=True)
            save_results(results)


if __name__ == "__main__":
    main()
