"""LLM integration for GlowScript code generation.

Uses the Ollama cloud (OpenAI-compatible /v1/chat/completions) API to generate
GlowScript/VPython code from a natural-language description. Falls back to a
built-in template if the LLM is unavailable.
"""
import re

import httpx


SYSTEM_PROMPT = (
    "You are a physics simulation expert. Generate GlowScript/VPython code "
    "that simulates the described physics phenomenon. "
    "Rules:\n"
    "1. Start with 'from vpython import *'\n"
    "2. Create a scene with 'scene = canvas()'\n"
    "3. Use an animation loop 'while True:' with 'rate(...)'\n"
    "4. Only output the code, no explanations.\n"
    "5. Use correct physics (gravity g=9.8, etc.)\n"
    "6. Output code inside ```python ... ``` fences."
)

FALLBACK_TEMPLATES = {
    "projectile": (
        "from vpython import *\n"
        "scene = canvas()\n"
        "ball = sphere(pos=vector(0,0,0), radius=0.5, color=color.red, make_trail=True)\n"
        "floor = box(pos=vector(0,-1,0), size=vector(20,0.1,1), color=color.green)\n"
        "ball.velocity = vector(5,10,0)\n"
        "g = vector(0,-9.8,0)\n"
        "dt = 0.01\n"
        "while True:\n"
        "    rate(100)\n"
        "    ball.velocity += g*dt\n"
        "    ball.pos += ball.velocity*dt\n"
        "    if ball.pos.y < 0:\n"
        "        ball.velocity.y = -ball.velocity.y*0.8\n"
    ),
    "pendulum": (
        "from vpython import *\n"
        "scene = canvas()\n"
        "pivot = vector(0,5,0)\n"
        "rod = cylinder(pos=pivot, axis=vector(0,-3,0), radius=0.05, color=color.white)\n"
        "bob = sphere(pos=pivot+vector(0,-3,0), radius=0.3, color=color.orange)\n"
        "theta = 0.5\n"
        "omega = 0\n"
        "L = 3\n"
        "g = 9.8\n"
        "dt = 0.01\n"
        "while True:\n"
        "    rate(100)\n"
        "    alpha = -(g/L)*sin(theta)\n"
        "    omega += alpha*dt\n"
        "    theta += omega*dt\n"
        "    bob.pos = pivot + vector(L*sin(theta), -L*cos(theta), 0)\n"
        "    rod.axis = bob.pos - pivot\n"
    ),
}


class LLMClient:
    """Client for the Ollama cloud OpenAI-compatible chat API."""

    def __init__(self, api_key: str, model: str = "deepseek-v4-flash:0731",
                 base_url: str = "https://ollama.com/v1"):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url

    def build_messages(self, description: str) -> list:
        """Build the system+user message list for the chat API."""
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": description},
        ]

    async def complete(self, messages: list) -> str:
        """Call the chat API and return the assistant's message content."""
        url = f"{self.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.4,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=headers, timeout=60)
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]


class GlowScriptGenerator:
    """Generate GlowScript code from a description, with template fallback."""

    def __init__(self, client=None):
        self.client = client

    def extract_code(self, response: str) -> str:
        """Extract Python/GlowScript code from an LLM response."""
        # Try fenced code block first
        m = re.search(r"```(?:python|glowscript)?\s*\n(.*?)```", response, re.S)
        if m:
            return m.group(1).strip()
        # Fallback: return whole response (strip leading prose heuristically)
        if "from vpython import *" in response:
            return response[response.index("from vpython import *"):].strip()
        return response.strip()

    def _fallback(self, description: str) -> str:
        """Return a template fallback based on keyword matching."""
        d = description.lower()
        if any(k in d for k in ["진자", "pendulum", "흔들"]):
            return FALLBACK_TEMPLATES["pendulum"]
        return FALLBACK_TEMPLATES["projectile"]

    async def generate(self, description: str) -> str:
        """Generate GlowScript code, falling back to a template on failure."""
        if self.client is None:
            return self._fallback(description)
        try:
            messages = self.client.build_messages(description)
            response = await self.client.complete(messages)
            code = self.extract_code(response)
            if "from vpython import *" not in code:
                return self._fallback(description)
            return code
        except Exception:
            return self._fallback(description)
