import pytest
from fastapi.testclient import TestClient

from todo_store import TodoStore
from main import create_app


@pytest.fixture()
def store(tmp_path):
    """각 테스트마다 임시 JSON 파일을 사용하는 독립적인 저장소."""
    return TodoStore(tmp_path / "todos.json")


@pytest.fixture()
def client(store):
    app = create_app(store)
    return TestClient(app)


def test_get_empty_todos(client):
    res = client.get("/api/todos")
    assert res.status_code == 200
    assert res.json() == []


def test_create_todo(client):
    res = client.post("/api/todos", json={"title": "테스트 할 일"})
    assert res.status_code == 201
    data = res.json()
    assert data["title"] == "테스트 할 일"
    assert data["done"] is False
    assert "id" in data


def test_create_todo_requires_title(client):
    res = client.post("/api/todos", json={})
    assert res.status_code == 422


def test_list_returns_created_todos(client):
    client.post("/api/todos", json={"title": "첫 번째"})
    client.post("/api/todos", json={"title": "두 번째"})
    res = client.get("/api/todos")
    assert len(res.json()) == 2


def test_toggle_todo_done(client):
    created = client.post("/api/todos", json={"title": "완료할 일"}).json()
    tid = created["id"]
    res = client.patch(f"/api/todos/{tid}/toggle")
    assert res.status_code == 200
    assert res.json()["done"] is True
    # 다시 토글하면 완료 해제
    res = client.patch(f"/api/todos/{tid}/toggle")
    assert res.json()["done"] is False


def test_toggle_missing_todo_404(client):
    res = client.patch("/api/todos/999/toggle")
    assert res.status_code == 404


def test_delete_todo(client):
    created = client.post("/api/todos", json={"title": "삭제할 일"}).json()
    tid = created["id"]
    res = client.delete(f"/api/todos/{tid}")
    assert res.status_code == 204
    assert client.get("/api/todos").json() == []


def test_delete_missing_todo_404(client):
    res = client.delete("/api/todos/999")
    assert res.status_code == 404


def test_index_serves_html(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]


def test_todo_store_persists(tmp_path):
    """저장소가 JSON 파일에 데이터를 유지하는지 검증."""
    path = tmp_path / "todos.json"
    store = TodoStore(path)
    store.add("지속성 테스트")
    store2 = TodoStore(path)
    items = store2.all()
    assert len(items) == 1
    assert items[0]["title"] == "지속성 테스트"
