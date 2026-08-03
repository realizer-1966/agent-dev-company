import json
import os
from typing import List, Optional


class TodoStore:
    """JSON 파일 기반의 할 일 저장소."""

    def __init__(self, path: str):
        self.path = path

    def _load(self) -> List[dict]:
        if not os.path.exists(self.path):
            return []
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save(self, todos: List[dict]) -> None:
        d = os.path.dirname(self.path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(todos, f, ensure_ascii=False, indent=2)

    def all(self) -> List[dict]:
        return self._load()

    def add(self, title: str) -> dict:
        todos = self._load()
        tid = (max((t["id"] for t in todos), default=0)) + 1
        todo = {"id": tid, "title": title, "done": False}
        todos.append(todo)
        self._save(todos)
        return todo

    def get(self, todo_id: int) -> Optional[dict]:
        for t in self._load():
            if t["id"] == todo_id:
                return t
        return None

    def toggle(self, todo_id: int) -> Optional[dict]:
        todos = self._load()
        for t in todos:
            if t["id"] == todo_id:
                t["done"] = not t["done"]
                self._save(todos)
                return t
        return None

    def delete(self, todo_id: int) -> bool:
        todos = self._load()
        remaining = [t for t in todos if t["id"] != todo_id]
        if len(remaining) == len(todos):
            return False
        self._save(remaining)
        return True
