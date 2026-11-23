"""Serve verified build-time gzip assets; never compress private HTML or bill data."""

import hashlib
import json
import mimetypes
from pathlib import Path

from flask import request, send_from_directory
from werkzeug.utils import safe_join


def install(app):
    original = app.view_functions["static"]
    static = Path(app.static_folder)
    cached = {}
    manifest_path = static / "compressed-assets.json"

    def deliver(filename):
        if Path(filename).suffix not in {".js", ".css", ".svg"}:
            return original(filename=filename)
        joined = safe_join(str(static), filename)
        response = None
        if joined and request.accept_encodings["gzip"] > 0:
            source = Path(joined)
            compressed = Path(joined + ".gz")
            if source.is_file() and compressed.is_file() and manifest_path.is_file():
                stamp = (
                    source.stat().st_mtime_ns,
                    source.stat().st_size,
                    manifest_path.stat().st_mtime_ns,
                    compressed.stat().st_mtime_ns,
                )
                entry = cached.get(filename)
                if entry is None or entry[0] != stamp:
                    try:
                        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                        expected = manifest.get(filename, {})
                        valid = (
                            isinstance(expected, dict)
                            and expected.get("source")
                            == hashlib.sha256(source.read_bytes()).hexdigest()
                            and expected.get("gzip")
                            == hashlib.sha256(compressed.read_bytes()).hexdigest()
                        )
                    except (OSError, ValueError):
                        valid = False
                    cached[filename] = (stamp, valid)
                if cached[filename][1]:
                    response = send_from_directory(
                        static,
                        filename + ".gz",
                        mimetype=mimetypes.guess_type(filename)[0] or "application/octet-stream",
                        conditional=True,
                    )
                    response.headers["Content-Encoding"] = "gzip"
        if response is None:
            response = original(filename=filename)
        response.vary.add("Accept-Encoding")
        return response

    app.view_functions["static"] = deliver
