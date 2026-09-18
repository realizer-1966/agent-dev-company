#!/usr/bin/env bash
# 치매 대화(TTS/ASR) 서버 관리 스크립트.
#
#   bash server.sh start     서버 기동 (이미 떠 있으면 그대로 둠)
#   bash server.sh stop      정상 종료 (모델 언로드 후)
#   bash server.sh restart   재기동
#   bash server.sh status    상태 출력 (exit 0=정상, 1=중지)
#   bash server.sh ensure    자동복구 — 죽어 있으면 살림 (watchdog 용)
#
# proot 주의사항이 두 가지 있다 (실측으로 겪은 문제):
#  1) `ps aux` 가 프로세스를 거의 못 보여준다 → /proc/*/cmdline 순회로 찾는다.
#  2) SIGKILL 로 죽이면 모델이 메모리에 남아 다음 추론이 24배 느려진다
#     → SIGTERM 으로 정상 종료해 모델을 언로드시킨다.
set -uo pipefail

PROJ=/root/workspace/agent-dev-company/projects/dementia-conversation
# 실제 모델/바이너리는 검증 작업 디렉토리에 있다 (모델은 대용량이라 저장소에 없음)
WORK=/root/workspace/audio-cpp-transcribe-design
BIN=/root/workspace/audio.cpp/build/linux-arm64-cpu/bin/audiocpp_server
CONFIG="$WORK/unified_server.json"
PORT=8912
LOG="$WORK/unified_server.log"
PIDFILE="$WORK/.server.pid"
GRACE=20          # 정상 종료 대기 (초)
LAUNCH_WAIT=60    # 기동 후 /health 성공까지 대기 (초)

# ── 유틸 ─────────────────────────────────────────────────────────
# PID 얻기: 1) pidfile  2) /proc 순회 (pidfile 이 낡았을 때 대비)
find_pids() {
  local out=""
  if [ -f "$PIDFILE" ]; then
    local p; p=$(cat "$PIDFILE" 2>/dev/null)
    if [ -n "$p" ] && [ -r "/proc/$p/cmdline" ] \
       && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q audiocpp_server; then
      out="$p"
    fi
  fi
  # pidfile 로 못 찾았거나 낡은 경우 전체 순회
  for d in /proc/[0-9]*; do
    local pid=${d#/proc/}
    [ "$pid" = "$$" ] && continue
    local cmd
    cmd=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
    case "$cmd" in
      *audiocpp_server*) [ "$pid" != "$out" ] && out="$out $pid" ;;
    esac
  done
  echo $out
}

is_up() { curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; }

# ── 명령 ────────────────────────────────────────────────────────
do_status() {
  local pids; pids=$(find_pids)
  if is_up; then
    local h; h=$(curl -s -m 5 "http://127.0.0.1:$PORT/health" 2>/dev/null)
    echo "UP   port=$PORT pids='${pids:-?}'"
    echo "     $h"
    return 0
  fi
  if [ -n "$pids" ]; then
    echo "DOWN (프로세스는 있으나 응답 없음) pids='$pids'"
    return 1
  fi
  echo "DOWN (프로세스 없음)"
  return 1
}

do_stop() {
  local pids; pids=$(find_pids)
  if [ -z "$pids" ]; then echo "이미 중지됨"; return 0; fi
  echo "SIGTERM → $pids (정상 종료: 모델 언로드)"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  local i=0
  while [ $i -lt "$GRACE" ]; do
    pids=$(find_pids)
    [ -z "$pids" ] && break
    sleep 1; i=$((i+1))
  done
  pids=$(find_pids)
  if [ -n "$pids" ]; then
    echo "응답 없음 → SIGKILL $pids (모델이 메모리에 남을 수 있음)"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null
    sleep 2
  fi
  rm -f "$PIDFILE"
  echo "중지 완료"
}

do_start() {
  if is_up; then echo "이미 실행 중 (port $PORT)"; return 0; fi
  [ -x "$BIN" ]   || { echo "오류: 실행 파일 없음 — $BIN"; return 1; }
  [ -f "$CONFIG" ] || { echo "오류: 설정 없음 — $CONFIG"; return 1; }

  echo "기동: $BIN --config unified_server.json --port $PORT"
  cd "$WORK" || return 1
  # --cors-origins "*" 가 필수다:
  #   앱(WebView)은 file:// 에서 로드되므로 Origin: null 로 요청을 보내고,
  #   브라우저 fetch() 는 CORS 헤더가 없으면 응답을 차단한다.
  #   curl/Chrome 직접 접속은 CORS 를 적용받지 않아 이 문제가 드러나지 않는다.
  # setsid 로 세션을 분리해 이 스크립트가 끝나도 살아남게 한다
  setsid "$BIN" --config "$CONFIG" --port "$PORT" --backend cpu --threads 6 \
    --cors-origins "*" \
    --log-file "$LOG" >>"$WORK/unified_stdout.log" 2>&1 &
  echo $! > "$PIDFILE"

  local i=0
  while [ $i -lt "$LAUNCH_WAIT" ]; do
    if is_up; then
      echo "기동 완료 ($((i+1))초) — $(curl -s -m 5 "http://127.0.0.1:$PORT/health")"
      return 0
    fi
    sleep 1; i=$((i+1))
  done
  echo "오류: ${LAUNCH_WAIT}초 내에 응답하지 않음 — 로그: $LOG"
  return 1
}

case "${1:-status}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop && do_start ;;
  status)  do_status ;;
  ensure)
    # watchdog: 죽어 있으면 살리고, 살아 있으면 조용히 종료 (cron 무소음용)
    if is_up; then exit 0; fi
    echo "[$(date '+%F %T')] 서버 DOWN 감지 → 재기동"
    do_start
    ;;
  *) echo "사용: bash server.sh {start|stop|restart|status|ensure}"; exit 2 ;;
esac
