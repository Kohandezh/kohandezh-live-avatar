"""Export the `ready` library entries for a render run (docs/features/response-caching/SPEC.md,
REQ-071).

Runs inside the orchestrator container, with that install's settings and database:

    python -m services.orchestrator.src.library_export --out <file> [--key <key> ...]

It writes a JSON list in the input format of apps/api/setup/server/render_answers.py: `key`,
`question`, `answer` (the entry's answer text), and the fields the results import expects back
(REQ-021). render_answers.py copies every field except `answer` into its result row, so its results
file imports onto these entries (REQ-028). `batch`, `bridge_type` and `answer_original` are written
as the entry has them, null included. The command writes no row, and prints and logs keys only.
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, TextIO

from .config import get_settings
from .database import Database
from .logging import configure_logging

logger = logging.getLogger(__name__)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def _render_input(entry: Any) -> dict[str, Any]:
    metadata = entry["import_metadata"]
    metadata = json.loads(metadata) if isinstance(metadata, str) else metadata
    return {
        "key": entry["key"],
        "question": entry["question"],
        "answer": entry["answer_text"],
        "category": entry["category"],
        "category_title": entry["category_title"],
        "section_type": entry["section_type"],
        "technical": entry["technical"],
        "language": entry["language"],
        "answer_original": entry["answer_original"],
        "batch": metadata.get("batch"),
        "bridge_type": metadata.get("bridge_type"),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m services.orchestrator.src.library_export",
        description="Write the ready library entries in the input format of render_answers.py.",
    )
    parser.add_argument("--out", required=True, type=Path, help="the JSON file to write")
    parser.add_argument("--key", action="append", help="export only this entry (repeatable)")
    return parser.parse_args(argv)


async def run(args: argparse.Namespace, *, database: Database, out: TextIO) -> int:
    """One export. Returns the exit status: 1, and no file, when a named key is not a ready entry."""
    keys = list(dict.fromkeys(args.key)) if args.key else None
    entries = await database.ready_library_entries(keys)
    if keys is not None:
        found = {entry["key"] for entry in entries}
        missing = [key for key in keys if key not in found]
        if missing:
            for key in missing:
                print(f"{key}\tnot_ready", file=out)
            print(f"summary: export, not_ready={len(missing)}: failed, nothing written", file=out)
            return 1
    rows = [_render_input(entry) for entry in entries]
    args.out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    for row in rows:
        print(row["key"], file=out)
    print(f"summary: export, exported={len(rows)}: written to {args.out}", file=out)
    logger.info("library_export_written", extra={"count": len(rows), "keys": [row["key"] for row in rows]})
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_settings()
    configure_logging(settings.log_level)

    async def export_once() -> int:
        database = Database(settings.database_url, MIGRATIONS)
        await database.connect()
        try:
            return await run(args, database=database, out=sys.stdout)
        finally:
            await database.close()

    return asyncio.run(export_once())


if __name__ == "__main__":
    sys.exit(main())
