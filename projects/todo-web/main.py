from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from todo_store import TodoStore


class TodoIn(BaseModel):
    title: str


class TodoOut(BaseModel):
    id: int
    title: str
    done: bool


def create_app(store: TodoStore) -> FastAPI:
    app = FastAPI(title="Todo Web")

    @app.get("/", response_class=HTMLResponse)
    def index():
        return INDEX_HTML

    @app.get("/api/todos", response_model=List[TodoOut])
    def list_todos():
        return store.all()

    @app.post("/api/todos", response_model=TodoOut, status_code=201)
    def create_todo(todo: TodoIn):
        return store.add(todo.title)

    @app.patch("/api/todos/{todo_id}/toggle", response_model=TodoOut)
    def toggle_todo(todo_id: int):
        todo = store.toggle(todo_id)
        if todo is None:
            raise HTTPException(status_code=404, detail="Todo not found")
        return todo

    @app.delete("/api/todos/{todo_id}", status_code=204)
    def delete_todo(todo_id: int):
        if not store.delete(todo_id):
            raise HTTPException(status_code=404, detail="Todo not found")

    return app


INDEX_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>할 일 관리</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 16px; color: #333; }
    h1 { border-bottom: 2px solid #4caf50; padding-bottom: 8px; }
    form { display: flex; gap: 8px; margin-bottom: 20px; }
    input[type=text] { flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 16px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
    button:hover { opacity: 0.9; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid #eee; }
    li.done span { text-decoration: line-through; color: #999; }
    .toggle { background: #2196f3; }
    .delete { background: #f44336; margin-left: auto; }
    .count { color: #666; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>📝 할 일 관리</h1>
  <form id="addForm">
    <input type="text" id="newTodo" placeholder="새 할 일 입력..." autocomplete="off">
    <button type="submit">추가</button>
  </form>
  <div class="count" id="count"></div>
  <ul id="todoList"></ul>

  <script>
    const list = document.getElementById('todoList');
    const count = document.getElementById('count');
    const form = document.getElementById('addForm');
    const input = document.getElementById('newTodo');

    async function load() {
      const res = await fetch('/api/todos');
      const todos = await res.json();
      render(todos);
    }

    function render(todos) {
      count.textContent = `총 ${todos.length}개 · 완료 ${todos.filter(t => t.done).length}개`;
      list.innerHTML = '';
      todos.forEach(todo => {
        const li = document.createElement('li');
        li.className = todo.done ? 'done' : '';
        li.innerHTML = `<span>${escapeHtml(todo.title)}</span>`;
        const toggle = document.createElement('button');
        toggle.className = 'toggle';
        toggle.textContent = todo.done ? '↩️ 되돌리기' : '✔️ 완료';
        toggle.onclick = async () => {
          await fetch(`/api/todos/${todo.id}/toggle`, { method: 'PATCH' });
          load();
        };
        const del = document.createElement('button');
        del.className = 'delete';
        del.textContent = '🗑️ 삭제';
        del.onclick = async () => {
          await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
          load();
        };
        li.appendChild(toggle);
        li.appendChild(del);
        list.appendChild(li);
      });
    }

    function escapeHtml(str) {
      return str.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[c]);
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      input.value = '';
      load();
    };

    load();
  </script>
</body>
</html>
"""
