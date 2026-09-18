/*
 * asr_server.c — transcribe.cpp C API를 HTTP로 노출하는 최소 서버 (방식 D).
 *
 * 목적
 *   1) ASR을 audio.cpp(TTS)와 다른 프로세스로 격리 → ggml 심볼 충돌 원천 차단
 *      (두 레포가 서로 다른 버전의 ggml을 static lib `ggml` 이름으로 내장)
 *   2) 세션을 프로세스 수명 동안 유지 → 요청마다 모델을 재로드하지 않음
 *      (transcribe-cli 서브프로세스 방식 대비 최대 이득)
 *   3) 서버가 죽어도 앱은 HTTP 오류만 받음 → 크래시 격리
 *
 * 빌드 (검증된 명령)
 *   # 1) transcribe.cpp를 shared 라이브러리로
 *   cmake -S transcribe.cpp -B build -DTRANSCRIBE_BUILD_SHARED=ON \
 *         -DCMAKE_BUILD_TYPE=Release
 *   cmake --build build --parallel
 *
 *   # 2) 이 래퍼
 *   cc asr_server.c -I transcribe.cpp/include \
 *      -L transcribe.cpp/build/src -ltranscribe -o asr_server
 *
 * 프로토콜 (의도적으로 최소)
 *   POST /transcribe
 *     Content-Type: application/octet-stream
 *     Body: 16kHz mono float32 raw PCM (리틀엔디언)
 *     Query: ?language=ko  (선택)
 *   → 200 {"text": "...", "language": "ko", "segments":[{"t0_ms":..,"t1_ms":..,"text":".."}]}
 *   → 503 {"error": "..."}   (모델 로드/추론 실패)
 *
 *   GET /health
 *   → 200 {"ok":true,"model":"..."}
 *
 * 주의: 이 파일은 "동작하는 최소 예시"입니다. 프로덕션에서는
 *   - 16k 리샘플링을 클라이언트(또는 별도 계층)에서 수행하고
 *   - 동시 요청 처리를 위해 세션 풀 또는 뮤텍스를 추가하세요.
 *   transcribe 핸들은 개별적으로 스레드 안전하지 않습니다.
 */

#include "transcribe.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ---- 전역 세션 (프로세스 수명 동안 유지 = 워밍 상태) ------------------- */
static struct transcribe_session * g_session = NULL;
static const char *                g_model_path = NULL;

static int ensure_session(void) {
    if (g_session) return 0;
    transcribe_status st = transcribe_open(g_model_path, NULL, NULL, &g_session);
    if (st != TRANSCRIBE_OK) {
        fprintf(stderr, "transcribe_open: %s\n", transcribe_status_string(st));
        g_session = NULL;
        return -1;
    }
    return 0;
}

/* ---- JSON 문자열 이스케이프 (transcribe 반환값은 UTF-8) ---------------- */
static void json_string(const char * s) {
    putchar('"');
    if (s) {
        for (const unsigned char * p = (const unsigned char *) s; *p; ++p) {
            switch (*p) {
                case '"':  fputs("\\\"", stdout); break;
                case '\\': fputs("\\\\", stdout); break;
                case '\n': fputs("\\n",  stdout); break;
                case '\r': fputs("\\r",  stdout); break;
                case '\t': fputs("\\t",  stdout); break;
                default:
                    if (*p < 0x20) printf("\\u%04x", *p);
                    else           putchar(*p);
            }
        }
    }
    putchar('"');
}

/* ---- 응답 본체 ---------------------------------------------------------
 * 반환 포인터는 session 소유이므로, 다음 transcribe_run 전에 직렬화를 끝내야
 * 한다. 이 함수는 그 규칙을 지킨다 (모든 접근이 run 직후·동기).
 * ---------------------------------------------------------------------- */
static void emit_result(void) {
    printf("{\"text\":");
    json_string(transcribe_full_text(g_session));

    printf(",\"language\":");
    json_string(transcribe_detected_language(g_session));

    printf(",\"segments\":[");
    const int n_seg = transcribe_n_segments(g_session);
    for (int i = 0; i < n_seg; ++i) {
        struct transcribe_segment seg;
        transcribe_segment_init(&seg);            /* struct_size 채움 (필수) */
        if (transcribe_get_segment(g_session, i, &seg) != TRANSCRIBE_OK) continue;
        if (i) putchar(',');
        printf("{\"t0_ms\":%lld,\"t1_ms\":%lld,\"speaker_id\":%d,\"text\":",
               (long long) seg.t0_ms, (long long) seg.t1_ms, (int) seg.speaker_id);
        json_string(seg.text);
        putchar('}');
    }
    printf("]}");
}

/* ---- 요청 1건 처리 ----------------------------------------------------
 * 실제 서버에서는 이 함수를 HTTP 핸들러에서 호출한다.
 * 여기서는 stdin에서 float32 PCM을 읽어 처리하는 형태로 보여준다.
 * ---------------------------------------------------------------------- */
static int handle_one(const char * language) {
    /* 1) 입력 수집: float32 raw PCM */
    size_t cap = 16000 * 60;   /* 최대 60초 가정 */
    float * pcm = (float *) malloc(cap * sizeof(float));
    if (!pcm) return 503;
    size_t n = fread(pcm, sizeof(float), cap, stdin);

    if (n == 0) { free(pcm); printf("{\"error\":\"empty audio\"}"); return 400; }

    /* 2) 실행 파라미터. NULL = 라이브러리 기본값.
     *    언어 힌트를 줄 때만 구조체를 쓴다 (0-초기화 구조체는 기본값이 아님). */
    struct transcribe_run_params rp;
    transcribe_run_params_init(&rp);
    rp.language = language;                    /* NULL이면 자동 감지 */

    transcribe_status st = transcribe_run(g_session, pcm, (int) n, &rp);
    free(pcm);

    if (st != TRANSCRIBE_OK) {
        printf("{\"error\":"); json_string(transcribe_status_string(st)); putchar('}');
        return 503;
    }

    emit_result();
    return 200;
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s model.gguf [language]\n", argv[0]);
        return 2;
    }
    g_model_path   = argv[1];
    const char * lang = (argc >= 3) ? argv[2] : NULL;

    if (ensure_session() != 0) return 1;

    /* 실제 서버라면 여기서 HTTP listen 루프를 돈다.
     * 이 예시는 요청 1건을 stdin에서 읽어 stdout으로 응답한다. */
    int code = handle_one(lang);
    fprintf(stderr, "status=%d\n", code);

    /* 세션 정리. transcribe_close는 소유한 모델까지 해제한다. */
    if (g_session) transcribe_close(g_session);
    return code == 200 ? 0 : 1;
}
