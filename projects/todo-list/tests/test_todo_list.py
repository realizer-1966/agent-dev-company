"""Tests for TodoList class."""
import json
import os
import tempfile
from pathlib import Path

import pytest

from todo_list.todo_list import TodoList


@pytest.fixture
def todo_list():
    """Create a TodoList with a temporary JSON file."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        temp_path = f.name
    tl = TodoList(data_path=temp_path)
    yield tl
    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


class TestTodoList:
    """Test suite for TodoList."""

    def test_list_returns_empty_list_initially(self, todo_list):
        """list() should return [] when no todos exist."""
        assert todo_list.list() == []

    def test_add_returns_todo_with_correct_fields(self, todo_list):
        """add() should return a dict with id, text, done, created_at."""
        todo = todo_list.add("Buy milk")
        assert isinstance(todo, dict)
        assert "id" in todo
        assert "text" in todo
        assert "done" in todo
        assert "created_at" in todo
        assert todo["text"] == "Buy milk"
        assert todo["done"] is False

    def test_add_increments_id(self, todo_list):
        """Each add() should return a todo with an incremented id."""
        t1 = todo_list.add("First")
        t2 = todo_list.add("Second")
        assert t2["id"] == t1["id"] + 1

    def test_list_returns_all_todos(self, todo_list):
        """list() should return all added todos."""
        todo_list.add("Task A")
        todo_list.add("Task B")
        items = todo_list.list()
        assert len(items) == 2
        texts = [item["text"] for item in items]
        assert "Task A" in texts
        assert "Task B" in texts

    def test_done_marks_todo_as_complete(self, todo_list):
        """done() should set done=True on the specified todo."""
        todo = todo_list.add("Wash dishes")
        updated = todo_list.done(todo["id"])
        assert updated["done"] is True

    def test_done_returns_updated_todo(self, todo_list):
        """done() should return the updated todo dict."""
        todo = todo_list.add("Walk dog")
        updated = todo_list.done(todo["id"])
        assert updated["id"] == todo["id"]
        assert updated["text"] == "Walk dog"
        assert updated["done"] is True

    def test_done_raises_on_invalid_id(self, todo_list):
        """done() should raise ValueError for non-existent id."""
        with pytest.raises(ValueError, match="not found"):
            todo_list.done(999)

    def test_remove_deletes_todo(self, todo_list):
        """remove() should delete the specified todo."""
        todo = todo_list.add("Delete me")
        todo_list.remove(todo["id"])
        assert todo_list.list() == []

    def test_remove_raises_on_invalid_id(self, todo_list):
        """remove() should raise ValueError for non-existent id."""
        with pytest.raises(ValueError, match="not found"):
            todo_list.remove(999)

    def test_data_persists_to_json(self, todo_list):
        """Todos should be saved to the JSON file."""
        todo_list.add("Persist me")
        # Read the file directly
        with open(todo_list.data_path) as f:
            data = json.load(f)
        assert len(data) == 1
        assert data[0]["text"] == "Persist me"

    def test_loads_existing_data(self, todo_list):
        """TodoList should load existing data from JSON file."""
        todo_list.add("Load me")
        # Create a new TodoList pointing to the same file
        tl2 = TodoList(data_path=todo_list.data_path)
        items = tl2.list()
        assert len(items) == 1
        assert items[0]["text"] == "Load me"

    def test_auto_creates_file_if_missing(self):
        """TodoList should create the JSON file if it doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "todos.json")
            assert not os.path.exists(path)
            tl = TodoList(data_path=path)
            assert os.path.exists(path)
            assert tl.list() == []
