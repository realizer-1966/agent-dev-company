"""Tests for the GlowScript code validator."""
import pytest

from glowscript_agent.validator import (
    ValidationResult,
    validate_code,
    validate_file,
)


def test_validate_code_accepts_valid_glowscript():
    code = (
        "from vpython import *\n"
        "ball = sphere(pos=vector(0,0,0), radius=0.5)\n"
        "while True:\n"
        "    rate(100)\n"
    )
    result = validate_code(code)
    assert result.valid is True
    assert result.errors == []


def test_validate_code_rejects_missing_import():
    code = "ball = sphere(pos=vector(0,0,0))"
    result = validate_code(code)
    assert result.valid is False
    assert any("import" in e for e in result.errors)


def test_validate_code_rejects_missing_while_loop():
    code = "from vpython import *\nball = sphere()\n"
    result = validate_code(code)
    assert result.valid is False
    assert any("while" in e for e in result.errors)


def test_validate_code_rejects_missing_rate():
    code = (
        "from vpython import *\n"
        "ball = sphere()\n"
        "while True:\n"
        "    pass\n"
    )
    result = validate_code(code)
    assert result.valid is False
    assert any("rate" in e for e in result.errors)


def test_validate_code_rejects_syntax_error():
    code = "from vpython import *\nball = sphere(\n"
    result = validate_code(code)
    assert result.valid is False
    assert result.errors


def test_validate_file(tmp_path):
    f = tmp_path / "scene.py"
    f.write_text("from vpython import *\nball = sphere()\nwhile True:\n    rate(100)\n")
    result = validate_file(str(f))
    assert result.valid is True


def test_validate_file_missing_raises():
    with pytest.raises(FileNotFoundError):
        validate_file("/nonexistent/path/scene.py")


def test_validation_result_repr():
    r = ValidationResult(valid=True, errors=[])
    assert "valid" in repr(r)
