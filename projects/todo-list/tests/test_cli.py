"""Tests for todo-list CLI commands."""
import json
import os
import tempfile
from pathlib import Path

import pytest
from click.testing import CliRunner

from todo_list.cli import main


@pytest.fixture
def runner():
    """Create a CliRunner."""
    return CliRunner()


@pytest.fixture
def temp_data_path():
    """Create a temporary file path for test data."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    yield path
    if os.path.exists(path):
        os.unlink(path)


class TestAddCommand:
    """Tests for the 'add' command."""

    def test_add_creates_todo(self, runner, temp_data_path):
        """add should create a new todo and print confirmation."""
        result = runner.invoke(main, ["--data-path", temp_data_path, "add", "Buy milk"])
        assert result.exit_code == 0
        assert "추가됨" in result.output
        assert "Buy milk" in result.output

    def test_add_persists_to_file(self, runner, temp_data_path):
        """add should persist the todo to the JSON file."""
        runner.invoke(main, ["--data-path", temp_data_path, "add", "Persist me"])
        with open(temp_data_path) as f:
            data = json.load(f)
        assert len(data) == 1
        assert data[0]["text"] == "Persist me"

    def test_add_with_empty_text(self, runner, temp_data_path):
        """add should reject empty text."""
        result = runner.invoke(main, ["--data-path", temp_data_path, "add", ""])
        assert result.exit_code != 0


class TestListCommand:
    """Tests for the 'list' command."""

    def test_list_empty(self, runner, temp_data_path):
        """list should show '할일이 없습니다.' when no todos exist."""
        result = runner.invoke(main, ["--data-path", temp_data_path, "list"])
        assert result.exit_code == 0
        assert "할일이 없습니다." in result.output

    def test_list_shows_todos(self, runner, temp_data_path):
        """list should show all todos with number, status, text, and date."""
        runner.invoke(main, ["--data-path", temp_data_path, "add", "Task A"])
        runner.invoke(main, ["--data-path", temp_data_path, "add", "Task B"])
        result = runner.invoke(main, ["--data-path", temp_data_path, "list"])
        assert result.exit_code == 0
        assert "[1]" in result.output
        assert "[2]" in result.output
        assert "Task A" in result.output
        assert "Task B" in result.output

    def test_list_shows_done_status(self, runner, temp_data_path):
        """list should show [✓] for done todos and [ ] for pending."""
        runner.invoke(main, ["--data-path", temp_data_path, "add", "Pending task"])
        # Manually mark as done via the data file
        with open(temp_data_path) as f:
            data = json.load(f)
        data[0]["done"] = True
        with open(temp_data_path, "w") as f:
            json.dump(data, f)
        result = runner.invoke(main, ["--data-path", temp_data_path, "list"])
        assert result.exit_code == 0
        assert "[✓]" in result.output

    def test_list_shows_date(self, runner, temp_data_path):
        """list should show the creation date."""
        runner.invoke(main, ["--data-path", temp_data_path, "add", "Dated task"])
        result = runner.invoke(main, ["--data-path", temp_data_path, "list"])
        assert result.exit_code == 0
        # Should contain a date like 2026-08-03
        import re
        assert re.search(r"\d{4}-\d{2}-\d{2}", result.output)
