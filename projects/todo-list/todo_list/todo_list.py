"""TodoList class — JSON file-based todo list manager."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone


class TodoList:
    """A simple todo list backed by a JSON file."""

    def __init__(self, data_path: str | None = None):
        if data_path is None:
            data_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "todos.json",
            )
        self.data_path = data_path
        self._ensure_file()

    def _ensure_file(self):
        """Create the JSON file with an empty list if it doesn't exist or is empty."""
        if not os.path.exists(self.data_path) or os.path.getsize(self.data_path) == 0:
            with open(self.data_path, "w") as f:
                json.dump([], f)
                f.write("\n")

    def _read(self) -> list[dict]:
        """Read todos from the JSON file."""
        with open(self.data_path) as f:
            return json.load(f)

    def _write(self, todos: list[dict]):
        """Write todos to the JSON file."""
        with open(self.data_path, "w") as f:
            json.dump(todos, f, indent=2, ensure_ascii=False)

    def list(self) -> list[dict]:
        """Return all todos."""
        return self._read()

    def add(self, text: str, category: str = "일반") -> dict:
        """Add a new todo and return it."""
        todos = self._read()
        new_id = max((t["id"] for t in todos), default=0) + 1
        todo = {
            "id": new_id,
            "text": text,
            "done": False,
            "category": category,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        todos.append(todo)
        self._write(todos)
        return todo

    def list_by_category(self) -> dict[str, list[dict]]:
        """Return todos grouped by category."""
        todos = self._read()
        grouped: dict[str, list[dict]] = {}
        for todo in todos:
            cat = todo.get("category", "일반")
            grouped.setdefault(cat, []).append(todo)
        return grouped

    def categories(self) -> list[str]:
        """Return all unique category names."""
        todos = self._read()
        cats = set()
        for todo in todos:
            cats.add(todo.get("category", "일반"))
        return sorted(cats)

    def done(self, todo_id: int) -> dict:
        """Mark a todo as done and return the updated todo."""
        todos = self._read()
        for todo in todos:
            if todo["id"] == todo_id:
                todo["done"] = True
                self._write(todos)
                return todo
        raise ValueError(f"Todo with id {todo_id} not found")

    def remove(self, todo_id: int) -> None:
        """Remove a todo by id."""
        todos = self._read()
        for i, todo in enumerate(todos):
            if todo["id"] == todo_id:
                del todos[i]
                self._write(todos)
                return
        raise ValueError(f"Todo with id {todo_id} not found")
