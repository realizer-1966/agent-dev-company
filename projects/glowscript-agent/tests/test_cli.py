"""Tests for the glowscript-agent CLI."""
from click.testing import CliRunner

from glowscript_agent.cli import main


def test_cli_generate():
    runner = CliRunner()
    result = runner.invoke(main, ["generate", "공을 위로 던지는 운동"])
    assert result.exit_code == 0
    assert "from vpython import *" in result.output


def test_cli_knowledge():
    runner = CliRunner()
    result = runner.invoke(main, ["knowledge", "sphere"])
    assert result.exit_code == 0
    assert "sphere" in result.output


def test_cli_validate(tmp_path):
    f = tmp_path / "scene.py"
    f.write_text("from vpython import *\nball = sphere()\nwhile True:\n    rate(100)\n")
    runner = CliRunner()
    result = runner.invoke(main, ["validate", str(f)])
    assert result.exit_code == 0
    assert "valid" in result.output.lower()


def test_cli_no_args_shows_help():
    # Click groups exit with code 2 and print usage when no subcommand is given.
    runner = CliRunner()
    result = runner.invoke(main, [])
    assert result.exit_code == 2
    assert "Usage" in result.output
