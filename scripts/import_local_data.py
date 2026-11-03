#!/usr/bin/env python3
"""Copy data from a local My Space install (its .private folder) into the Worker's KV.

    python3 scripts/import_local_data.py "/path/to/Personal website" --local    # wrangler dev storage
    python3 scripts/import_local_data.py "/path/to/Personal website" --remote   # the deployed site

Copies the shared state (spaces, schedule, study tasks, progress, theme, colours),
the Moodle deadline archive, uploaded assignment files and the background photo.
Existing values under the same KV keys are overwritten. The source is only read.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def wrangler(*args):
    subprocess.run(["npx", "wrangler", *args], check=True, stdout=subprocess.DEVNULL)


def put(key, path, target, metadata=None):
    args = ["kv", "key", "put", key, "--path", str(path), "--binding", "PLANNER", target]
    if metadata is not None:
        args += ["--metadata", json.dumps(metadata)]
    wrangler(*args)
    print(f"  {key}")


def image_type(payload):
    if payload.startswith(b"\x89PNG"):
        return "image/png"
    if payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", type=Path, help="folder that contains .private/")
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--local", action="store_const", const="--local", dest="target")
    where.add_argument("--remote", action="store_const", const="--remote", dest="target")
    options = parser.parse_args()

    private = options.source / ".private"
    if not private.is_dir():
        sys.exit(f"No .private folder in {options.source}")

    print(f"Importing into {'the deployed site' if options.target == '--remote' else 'local wrangler dev storage'}:")

    state = private / "shared-state.json"
    if state.exists():
        json.loads(state.read_text(encoding="utf-8"))  # refuse to upload a broken file
        put("shared_state", state, options.target)

    archive = private / "moodle-assignments.json"
    if archive.exists():
        json.loads(archive.read_text(encoding="utf-8"))
        put("moodle_assignments", archive, options.target)

    files_dir = private / "assignment-files"
    if files_dir.is_dir():
        index = []
        for meta_path in sorted(files_dir.glob("*.json")):
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            data = files_dir / meta["id"]
            if data.exists():
                put(f"file:{meta['id']}", data, options.target)
                index.append(meta)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(index, tmp, ensure_ascii=False)
        put("file_index", tmp.name, options.target)
        Path(tmp.name).unlink()

    background = private / "background-image"
    if background.exists():
        put("background_image", background, options.target, {"type": image_type(background.read_bytes()[:16])})

    print("Done.")


if __name__ == "__main__":
    main()
