#!/usr/bin/env bash
# 단일 엔진(오디오.cpp만) TTS → ASR 왕복 검증.
# 분리형(run_pipeline.sh)과 달리 HTTP 서버 1개만 뜬다.
set -uo pipefail

WS=/root/workspace
D=$WS/audio-cpp-transcribe-design
AUDIOCPP=$WS/audio.cpp/build/linux-arm64-cpu/bin
PORT=8912
TEXT="안녕하세요. 오늘은 날씨가 좋습니다."

cd "$D" || exit 1

echo "== 서버 기동 (:$PORT, 모델 2개: TTS+ASR) =="
"$AUDIOCPP/audiocpp_server" --config unified_server.json --port $PORT \
  --backend cpu --threads 6 --log-file "$D/unified_server.log" \
  > "$D/unified_stdout.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 1
done
curl -s -m 5 "http://127.0.0.1:$PORT/health"; echo

echo "== TTS =="
curl -s -m 300 -o uni_tts_ko.wav -w "  HTTP=%{http_code} bytes=%{size_download} time=%{time_total}s\n" \
  -X POST "http://127.0.0.1:$PORT/v1/audio/speech" -H "Content-Type: application/json" \
  -d "{\"model\":\"supertonic-ko\",\"input\":\"$TEXT\",\"voice\":\"M1\",\"response_format\":\"wav\"}"

echo "== ASR (같은 서버, WAV 그대로 업로드 — 리샘플 불필요) =="
curl -s -m 300 -X POST "http://127.0.0.1:$PORT/v1/audio/transcriptions" \
  -F model=qwen3-asr -F language=ko -F file=@uni_tts_ko.wav \
  -w "\n  HTTP=%{http_code} time=%{time_total}s\n"
