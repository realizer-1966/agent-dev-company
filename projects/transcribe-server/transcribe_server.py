#!/usr/bin/env python3
"""transcribe.cpp HTTP 래퍼 — audio.cpp 호환 /v1/audio/transcriptions API.

transcribe-cli (Moonshine tiny-ko/ja)를 subprocess로 호출.
오디오: multipart form (file=...) → 16kHz mono WAV → 전사 → audio.cpp 형식 JSON 응답.
"""
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

CLI = "/tmp/transcribe.cpp/build-cpu/bin/transcribe-cli"
MODELS = {
    "moonshine-tiny-ko": "/tmp/moonshine-tiny-ko-Q8_0.gguf",
    "moonshine-tiny-ja": "/tmp/moonshine-tiny-ja-Q8_0.gguf",
}


def wav_duration_ms(path):
    """WAV 길이(ms) 계산 — 16kHz mono 16bit 가정."""
    try:
        import struct
        with open(path, "rb") as f:
            data = f.read()
        # data 청크 찾기
        i = data.find(b"data", 12)
        if i < 0:
            return 0
        size = int.from_bytes(data[i+4:i+8], "little")
        return int(size / 2 / 16000 * 1000)
    except Exception:
        return 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/v1/models":
            body = json.dumps({"object": "list", "data": [
                {"id": k, "object": "model", "owned_by": "transcribe.cpp",
                 "family": "moonshine", "task": "asr", "mode": "offline", "loaded": True}
                for k in MODELS
            ]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def do_POST(self):
        if self.path != "/v1/audio/transcriptions":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        t0 = time.time()
        ctype = self.headers.get("Content-Type", "")
        # multipart 파싱 (표준 라이브러리)
        if "multipart/form-data" in ctype:
            boundary = ctype.split("boundary=")[1].encode()
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            parts = body.split(b"--" + boundary)
            audio = None
            model = "moonshine-tiny-ko"
            for p in parts:
                if b"filename=" in p:
                    idx = p.find(b"\r\n\r\n")
                    if idx > 0:
                        audio = p[idx+4:]
                        if audio.endswith(b"\r\n"):
                            audio = audio[:-2]
                elif b'name="model"' in p:
                    idx = p.find(b"\r\n\r\n")
                    if idx > 0:
                        val = p[idx+4:].strip(b"\r\n ")
                        if val:
                            model = val.decode()
            if audio is None:
                self._json(400, {"error": {"message": "no audio file"}})
                return
            tmp = "/tmp/tcpp_upload.wav"
            with open(tmp, "wb") as f:
                f.write(audio)
        else:
            self._json(415, {"error": {"message": "unsupported content type"}})
            return

        model_path = MODELS.get(model, MODELS["moonshine-tiny-ko"])
        dur = wav_duration_ms(tmp)
        try:
            r = subprocess.run([CLI, "-m", model_path, tmp, "-q"],
                               capture_output=True, text=True, timeout=120,
                               cwd="/tmp/transcribe.cpp/build-cpu")
        except subprocess.TimeoutExpired:
            self._json(504, {"error": {"message": "timeout"}})
            return
        wall_ms = int((time.time() - t0) * 1000)
        if r.returncode != 0:
            self._json(500, {"error": {"message": r.stderr[-200:] or "transcribe failed"}})
            return
        text = ""
        for line in r.stdout.splitlines():
            if line.startswith("text: "):
                text = line[6:]
        rtf = round(wall_ms / dur, 3) if dur > 0 else 0
        self._json(200, {
            "text": text,
            "timing": {"wall_ms": wall_ms, "audio_duration_ms": dur, "rtf": rtf},
        })

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8178"))
    print(f"transcribe.cpp wrapper on :{port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
