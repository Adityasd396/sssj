"""Precompress public text assets once at build time, never customer documents."""

import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build():
    static = ROOT / "static"
    manifest = {}
    for source in sorted(static.rglob("*")):
        if source.suffix not in {".js", ".css", ".svg"} or not source.is_file():
            continue
        data = source.read_bytes()
        compressed = gzip.compress(data, compresslevel=9, mtime=0)
        if len(data) >= 1024 and len(compressed) < len(data) * 0.9:
            source.with_name(source.name + ".gz").write_bytes(compressed)
            manifest[source.relative_to(static).as_posix()] = {
                "source": hashlib.sha256(data).hexdigest(),
                "gzip": hashlib.sha256(compressed).hexdigest(),
            }
    (static / "compressed-assets.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return len(manifest)


if __name__ == "__main__":
    print(f"Precompressed {build()} public assets.")
