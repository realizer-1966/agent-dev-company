"""Tests for todo-list CLI commands using Click's CliRunner."""
import json
import os
import tempfile

import pytest
from click.testing import CliRunner

from todo_list.cli import main
from todo_list.todo_list import TodoList


@pytest.fixture
def runner():
    """Create a CliRunner instance."""
    return CliRunner()


@pytest.fixture
def temp_todo_path():
    """Create a temporary JSON file path for testing."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    yield path
    if os.path.exists(path):
        os.unlink(path)


def test_cli_add(runner, temp_todo_path):
    """add command should create a new todo."""
    result = runner.invoke(main, ["--data-path", temp_todo_path, "add", "Buy milk"])
    assert result.exit_code == 0
    assert "Buy milk" in result.output
    # Verify it was saved
    tl = TodoList(data_path=temp_todo_path)
    items = tl.list()
    assert len(items) == 1
    assert items[0]["text"] == "Buy milk"


def test_cli_list_empty(runner, temp_todo_path):
    """list command should show empty message when no todos."""
    result = runner.invoke(main, ["--data-path", temp_todo_path, "list"])
    assert result.exit_code == 0
    assert "할일이 없습니다" in result.output


def test_cli_list_with_items(runner, temp_todo_path):
    """list command should show all todos."""
    tl = TodoList(data_path=temp_todo_path)
    tl.add("Task A")
    tl.add("Task B")
    result = runner.invoke(main, ["--data-path", temp_todo_path, "list"])
    assert result.exit_code == 0
    assert "[1]" in result.output
    assert "[2]" in result.output
    assert "Task A" in result.output
    assert "Task B" in result.output


def test_cli_done(runner, temp_todo_path):
    """done command should mark a todo as complete."""
    tl = TodoList(data_path=temp_todo_path)
    todo = tl.add("Wash dishes")
    result = runner.invoke(main, ["--data-path", temp_todo_path, "done", str(todo["id"])])
    assert result.exit_code == 0
    assert "완료" in result.output
    # Verify via data layer
    updated = tl.done(todo["id"])
    assert updated["done"] is True


def test_cli_done_shows_checkmark_in_list(runner, temp_todo_path):
    """After done, list should show [✓] marker."""
    tl = TodoList(data_path=temp_todo_path)
    todo = tl.add("Walk dog")
    tl.done(todo["id"])
    result = runner.invoke(main, ["--data-path", temp_todo_path, "list"])
    assert result.exit_code == 0
    assert "✓" in result.output


def test_cli_done_invalid_id(runner, temp_todo_path):
    """done with non-existent id should show error."""
    result = runner.invoke(main, ["--data-path", temp_todo_path, "done", "999"])
    assert result.exit_code != 0
    assert "not found" in result.output.lower() or "찾을 수 없" in result.output


def test_cli_remove(runner, temp_todo_path):
    """remove command should delete a todo."""
    tl = TodoList(data_path=temp_todo_path)
    todo = tl.add("Delete me")
    result = runner.invoke(main, ["--data-path", temp_todo_path, "remove", str(todo["id"])])
    assert result.exit_code == 0
    assert "삭제" in result.output
    # Verify via data layer
    assert tl.list() == []


def test_cli_remove_invalid_id(runner, temp_todo_path):
    """remove with non-existent id should show error."""
    result = runner.invoke(main, ["--data-path", temp_todo_path, "remove", "999"])
    assert result.exit_code != 0
    assert "not found" in result.output.lower() or "찾을 수 없" in result.output


def test_cli_add_and_list_integration(runner, temp_todo_path):
    """Full integration: add items, list them, done one, remove one."""
    # Add items
    runner.invoke(main, ["--data-path", temp_todo_path, "add", "First"])
    runner.invoke(main, ["--data-path", temp_todo_path, "add", "Second"])
    runner.invoke(main, ["--data-path", temp_todo_path, "add", "Third"])

    # List should show 3 items
    result = runner.invoke(main, ["--data-path", temp_todo_path, "list"])
    assert result.exit_code == 0
    assert "[1]" in result.output
    assert "[2]" in result.output
    assert "[3]" in result.output

    # Done item 2
    runner.invoke(main, ["--data-path", temp_todo_path, "done", "2"])

    # List should show [✓] on item 2
    result = runner.invoke(main, ["--data-path", temp_todo_path, "list"])
    assert "✓" in result.output

    # Remove item 1
    runner.invoke(main, ["--data-path", temp_todo_path, "remove", "1"])

    # List should show only 2 items (ids may differ)
    tl = TodoList(data_path=temp_todo_path)
    assert len(tl.list()) == 2
