"""Tests for the GlowScript LLM code generation service."""
import asyncio

import httpx2

from app.main import app
from app.llm import GlowScriptGenerator, LLMClient


async def _get(path):
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(path)


async def _post(path, json):
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, json=json)


def test_health_endpoint():
    """GET /health should return ok."""
    r = asyncio.run(_get("/health"))
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_generate_endpoint_returns_code():
    """POST /api/generate should return generated GlowScript code."""
    r = asyncio.run(_post("/api/generate", {"description": "공을 위로 던져 포물선 운동"}))
    assert r.status_code == 200
    data = r.json()
    assert "code" in data
    assert "from vpython import *" in data["code"]


def test_generate_requires_description():
    """POST /api/generate without description should return 422."""
    r = asyncio.run(_post("/api/generate", {}))
    assert r.status_code == 422


def test_llm_client_builds_request():
    """LLMClient should build a proper Ollama chat request."""
    client = LLMClient(api_key="test-key", model="deepseek-v4-flash:0731")
    prompt = "공을 위로 던지는 운동"
    msgs = client.build_messages(prompt)
    assert len(msgs) == 2  # system + user
    assert msgs[0]["role"] == "system"
    assert "GlowScript" in msgs[0]["content"]
    assert msgs[1]["role"] == "user"
    assert prompt in msgs[1]["content"]


def test_generator_extracts_code_from_response():
    """Generator should extract code from an LLM response."""
    gen = GlowScriptGenerator(client=None)
    llm_response = "Here is your code:\n```python\nfrom vpython import *\nscene = canvas()\n```"
    code = gen.extract_code(llm_response)
    assert "from vpython import *" in code
    assert "scene = canvas()" in code


def test_generator_extracts_code_without_fence():
    """Generator should handle responses without code fences."""
    gen = GlowScriptGenerator(client=None)
    llm_response = "from vpython import *\nscene = canvas()"
    code = gen.extract_code(llm_response)
    assert "from vpython import *" in code


def test_generator_returns_fallback_on_failure():
    """Generator should return a template fallback if LLM fails."""
    class _FailingClient:
        async def complete(self, messages):
            raise Exception("LLM unavailable")
    gen = GlowScriptGenerator(client=_FailingClient())
    code = asyncio.run(gen.generate("공을 위로 던지는 운동"))
    assert "from vpython import *" in code
    assert "ball" in code  # fallback to projectile template
