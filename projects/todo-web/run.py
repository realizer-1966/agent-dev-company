import uvicorn

from main import create_app
from todo_store import TodoStore

app = create_app(TodoStore("todos.json"))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
