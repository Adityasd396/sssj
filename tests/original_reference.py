"""Load the frozen pre-change application only against a separate in-memory database."""

import sys
import types
from pathlib import Path


def load_reference():
    source = (Path(__file__).parent / "fixtures" / "original_app.py.txt").read_text(
        encoding="utf-8"
    )
    source = source.replace(
        "app.config.from_object(Config)",
        "app.config.from_mapping(SECRET_KEY='reference-test-only', SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', SQLALCHEMY_TRACK_MODIFICATIONS=False, WTF_CSRF_ENABLED=False, TESTING=True)",
        1,
    )
    module = types.ModuleType("original_reference_app")
    module.__file__ = str(Path(__file__).resolve().parents[1] / "app.py")
    sys.modules[module.__name__] = module
    exec(compile(source, module.__file__, "exec"), module.__dict__)  # noqa: S102 - frozen local test fixture only
    # Rendering is unrelated to calculation compatibility; avoid current-template dependencies.
    module.render_template = lambda *_args, **_kwargs: "Reference form"
    return module
