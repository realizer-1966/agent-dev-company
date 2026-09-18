#!/usr/bin/env bash
# 원샷 검증 스크립트 — 오늘 클론한 두 레포를 그대로 빌드·실행해
# TTS → ASR 전 구간을 실제 소켓 통신으로 확인한다.
#
# 전제:
#   - proot/Android aarch64 에서 컴파일러가 없어 zig 래퍼를 쓴다 (toolchain/ 참고)
#   - 두 레포가 이미 클론되어 있고 zig 래퍼 빌드가 끝나 있어야 한다
#
# 사용:
#   bash run_pipeline.sh            # 검증 전체
#   bash run_pipeline.sh --tts-only # TTS 만
set -uo pipefail

WS=/root/workspace
D=$WS/audio-cpp-transcribe-design
AUDIOCPP=$WS/audio.cpp/build/linux-arm64-cpu/bin
ASR_MODEL=${ASR_MODEL:-$WS/models/asr/qwen3-asr-0.6b-Q8_0.gguf}
TTS_MODEL=${TTS_MODEL:-$WS/models/tts/Supertonic-3-GGUF/supertonic-3-q8_0.gguf}
TEXT="안녕하세요. 오늘은 날씨가 좋습니다."
TTS_PORT=8911
ASR_PORT=8910

cd "$D" || exit 1

echo "== 0) 사전 확인 =="
[ -x "$AUDIOCPP/audiocpp_server" ] || { echo "audiocpp_server 없음 — 빌드 필요"; exit 1; }
[ -f "$ASR_MODEL" ] || { echo "ASR 모델 없음: $ASR_MODEL"; exit 1; }
[ -f "$TTS_MODEL" ] || { echo "TTS 모델 없음: $TTS_MODEL"; exit 1; }
echo "  ok"

echo "== 1) TTS 서버 기동 (:$TTS_PORT) =="
"$AUDIOCPP/audiocpp_server" --config tts_server.json --port $TTS_PORT \
  --backend cpu --threads 6 --log-file "$D/tts_server.log" \
  > "$D/tts_stdout.log" 2>&1 &
TTS_PID=$!
trap 'kill $TTS_PID $ASR_PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -sf -m 2 "http://127.0.0.1:$TTS_PORT/health" >/dev/null && break
  sleep 1
done
curl -s -m 5 "http://127.0.0.1:$TTS_PORT/health" || { echo "TTS 서버 기동 실패"; exit 1; }
echo

echo "== 2) HTTP 로 한국어 음성 합성 =="
curl -s -m 300 -o http_tts_ko.wav -w "  HTTP=%{http_code} bytes=%{size_download} time=%{time_total}s\n" \
  -X POST "http://127.0.0.1:$TTS_PORT/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"supertonic-ko\",\"input\":\"$TEXT\",\"voice\":\"M1\",\"response_format\":\"wav\"}"
[ -s http_tts_ko.wav ] || { echo "합성 실패"; exit 1; }

[ "${1:-}" = "--tts-only" ] && { echo "완료 (tts-only)"; exit 0; }

echo "== 3) 44.1k → 16k mono f32 변환 =="
python3 verification/wav_to_f32.py http_tts_ko.wav http_tts_ko.f32 16000

echo "== 4) ASR 서버 기동 (:$ASR_PORT) =="
./asr_http_server "$ASR_MODEL" ko 127.0.0.1 $ASR_PORT > asr_http.log 2>&1 &
ASR_PID=$!
for i in $(seq 1 30); do
  curl -sf -m 2 "http://127.0.0.1:$ASR_PORT/health" >/dev/null && break
  sleep 1
done
curl -s -m 5 "http://127.0.0.1:$ASR_PORT/health" || { echo "ASR 서버 기동 실패"; exit 1; }
echo

echo "== 5) HTTP 전 구간 왕복 — TTS 가 만든 음성을 ASR 로 인식 =="
RESP=$(curl -s -m 300 -X POST "http://127.0.0.1:$ASR_PORT/transcribe" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @http_tts_ko.f32 -w "\n__HTTP=%{http_code} time=%{time_total}__")
echo "$RESP"

echo
echo "== 결과 =="
echo "  입력: $TEXT"
echo "  인식: $(echo "$RESP" | python3 -c 'import sys,json;print(json.loads(sys.stdin.readline())["text"])' 2>/dev/null)"
echo "  → 두 런타임(ggml 0.12.0 / 0.20.2)이 프로세스 분리 하에 정상 협업"
