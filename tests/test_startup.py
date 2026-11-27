"""Actual entry-point checks in a temporary copy, never the shop database."""

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


def staged_app(tmp_path):
    root = Path(__file__).resolve().parents[1]
    for name in [
        "app.py",
        "asset_delivery.py",
        "config.py",
        "passkeys.py",
        "security_controls.py",
        "database_recovery.py",
        "invoice_sharing.py",
        "tag_print_settings.py",
        "tag_pdf.py",
    ]:
        shutil.copy2(root / name, tmp_path / name)
    shutil.copytree(root / "templates", tmp_path / "templates")
    env = os.environ.copy()
    env.update(
        DATABASE_URL="sqlite:///" + (tmp_path / "isolated.db").as_posix(),
        SECRET_KEY="weak-test-key",
        FLASK_ENV="production",
        SESSION_COOKIE_SECURE="false",
        TRUST_PROXY="1",
    )
    return env


def test_direct_local_start_works_with_production_dotenv_settings(tmp_path):
    env = staged_app(tmp_path)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env["BILLING_LOCAL_PORT"] = str(port)
    log = tmp_path / "startup.log"
    with open(log, "w") as output:
        process = subprocess.Popen(
            [sys.executable, str(tmp_path / "app.py")],
            cwd=tmp_path,
            env=env,
            stdout=output,
            stderr=output,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            for _ in range(100):
                if process.poll() is not None:
                    pytest.fail(log.read_text())
                try:
                    response = urllib.request.urlopen(f"http://127.0.0.1:{port}/login", timeout=0.5)
                    break
                except urllib.error.URLError:
                    time.sleep(0.1)
            else:
                pytest.fail("Local startup did not respond: " + log.read_text())
            assert response.status == 200
            assert "Secure" not in response.headers.get("Set-Cookie", "")
            assert len((tmp_path / "instance" / ".session-key").read_text().strip()) >= 32
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/login", headers={"Host": "untrusted.example"}
            )
            with pytest.raises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(request, timeout=2)  # noqa: S310 - fixed loopback test URL
            assert rejected.value.code == 400
        finally:
            process.terminate()
            process.wait(timeout=10)


def test_wsgi_production_still_rejects_weak_settings(tmp_path):
    env = staged_app(tmp_path)
    result = subprocess.run(
        [sys.executable, "-c", "import app"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode != 0
    assert "Production needs a strong SECRET_KEY" in result.stderr
