"""FastAPI app for the GlowScript LLM generation service."""
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.llm import GlowScriptGenerator, LLMClient


class GenerateRequest(BaseModel):
    description: str


def _load_api_key() -> str:
    """Load the LLM API key from env or the Hermes config."""
    key = os.environ.get("GLOWSCRIPT_LLM_API_KEY", "")
    if key:
        return key
    # Fall back to the Hermes model config
    try:
        import yaml
        cfg_path = Path.home() / ".hermes" / "config.yaml"
        if cfg_path.exists():
            cfg = yaml.safe_load(cfg_path.read_text())
            return cfg.get("model", {}).get("api_key", "")
    except Exception:
        pass
    return ""


def create_app() -> FastAPI:
    """Build the FastAPI app with a real or mock LLM client."""
    app = FastAPI(title="GlowScript LLM Generator")

    # Read API key from env or Hermes config; if absent, fall back to templates.
    api_key = _load_api_key()
    if api_key:
        llm_client = LLMClient(api_key=api_key)
    else:
        llm_client = None
    generator = GlowScriptGenerator(client=llm_client)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/api/generate")
    async def generate(req: GenerateRequest):
        try:
            code = await generator.generate(req.description)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        return {"code": code, "description": req.description}

    return app


app = create_app()
