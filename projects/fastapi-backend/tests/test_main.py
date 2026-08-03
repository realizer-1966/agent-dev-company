"""Tests for the fastapi-backend app."""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """Provide a TestClient for the FastAPI app."""
    return TestClient(app)


def test_root_returns_200(client):
    """GET / should return 200 OK."""
    response = client.get("/")
    assert response.status_code == 200


def test_root_returns_expected_message(client):
    """GET / should return the hello message."""
    response = client.get("/")
    assert response.json() == {"message": "Hello from Agent Dev Company"}


def test_root_is_json(client):
    """GET / should return JSON content type."""
    response = client.get("/")
    assert response.headers["content-type"].startswith("application/json")


def test_unknown_route_returns_404(client):
    """GET /nope should return 404."""
    response = client.get("/nope")
    assert response.status_code == 404


def test_app_title():
    """The app should expose its configured title."""
    assert app.title == "Agent Dev Company API"
