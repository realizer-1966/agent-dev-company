/*
 * asr_http_server.c — transcribe.cpp C API를 노출하는 실제 HTTP 서버 (설계서 "방식 D").
 *
 * asr_server.c(stdin/stdout 예시)를 실제 소켓 서버로 확장한 버전이다.
 * 목적은 동일하다:
 *   1) ASR을 audio.cpp(TTS)와 다른 프로세스로 격리 → ggml 심볼 충돌 원천 차단
 *   2) 세션을 프로세스 수명 동안 유지 → 요청마다 모델 재로드 없음
 *   3) 서버가 죽어도 앱은 HTTP 오류만 받음 → 크래시 격리
 *
 * 빌드 (검증된 명령)
 *   B=/root/workspace/transcribe.cpp/build/linux-arm64-cpu
 *   zig-cc -O2 -w -I /root/workspace/transcribe.cpp/include asr_http_server.c \
 *     -o asr_http_server \
 *     $B/src/libtranscribe.a $B/ggml/src/libggml.a \
 *     $B/ggml/src/libggml-cpu.a $B/ggml/src/libggml-base.a \
 *     -lstdc++ -lm -lpthread
 *
 * 실행
 *   ./asr_http_server model.gguf ko 127.0.0.1 8910
 *
 * 프로토콜 (의도적으로 최소 — 설계서 §6.2 계약)
 *   GET  /health
 *     → 200 {"ok":true,"model":"...","language":"ko"}
 *
 *   POST /transcribe            (Content-Type: application/octet-stream)
 *     Body: 16kHz mono float32 raw PCM (little-endian). 길이 = Content-Length.
 *     → 200 {"text":"...","language":"...","segments":[{"t0_ms":..,"t1_ms":..,"speaker_id":..,"text":".."}]}
 *     → 400 {"error":"empty audio"} / {"error":"bad content-length"}
 *     → 503 {"error":"..."}   (모델 로드/추론 실패)
 *
 *   OPTIONS *  → 204 + CORS 헤더
 *
 * 한계 (프로덕션에서 보완할 것)
 *   - 단일 스레드 accept 루프. transcribe 핸들은 스레드 안전하지 않으므로
 *     동시성을 얻으려면 워커 프로세스(모델 복제) 또는 뮤텍스 직렬화를 쓰세요.
 *   - 16k 리샘플링은 클라이언트 책임 (라이브러리에 리샘플러가 없음).
 *   - 요청 본문은 최대 MAX_BODY 바이트로 제한.
 */

#include "transcribe.h"

#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define MAX_BODY (16000 * 4 * 300) /* 최대 300초 f32 mono @16k = 19.2 MB */

/* ---- 전역 세션 (프로세스 수명 동안 유지 = 워밍 상태) ------------------- */
static struct transcribe_session * g_session    = NULL;
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

/* ---- 출력 버퍼 --------------------------------------------------------- */
typedef struct {
    char * buf;
    size_t len;
    size_t cap;
} outbuf;

static void ob_init(outbuf * o, size_t cap) {
    o->buf = (char *) malloc(cap);
    o->len = 0;
    o->cap = cap;
    if (o->buf) o->buf[0] = '\0';
}

static void ob_reserve(outbuf * o, size_t extra) {
    if (!o->buf) return;
    if (o->len + extra + 1 <= o->cap) return;
    size_t ncap = o->cap * 2;
    while (ncap < o->len + extra + 1) ncap *= 2;
    char * nb = (char *) realloc(o->buf, ncap);
    if (!nb) return;
    o->buf = nb;
    o->cap = ncap;
}

static void ob_puts(outbuf * o, const char * s) {
    if (!o->buf || !s) return;
    size_t n = strlen(s);
    ob_reserve(o, n);
    memcpy(o->buf + o->len, s, n);
    o->len += n;
    o->buf[o->len] = '\0';
}

static void ob_putc(outbuf * o, char c) {
    if (!o->buf) return;
    ob_reserve(o, 1);
    o->buf[o->len++] = c;
    o->buf[o->len] = '\0';
}

static void ob_free(outbuf * o) {
    free(o->buf);
    o->buf = NULL;
    o->len = o->cap = 0;
}

/* ---- JSON 문자열 이스케이프 (transcribe 반환값은 UTF-8) ---------------- */
static void ob_json_string(outbuf * o, const char * s) {
    ob_putc(o, '"');
    if (s) {
        for (const unsigned char * p = (const unsigned char *) s; *p; ++p) {
            switch (*p) {
                case '"':  ob_puts(o, "\\\""); break;
                case '\\': ob_puts(o, "\\\\"); break;
                case '\n': ob_puts(o, "\\n");  break;
                case '\r': ob_puts(o, "\\r");  break;
                case '\t': ob_puts(o, "\\t");  break;
                default:
                    if (*p < 0x20) {
                        char tmp[8];
                        snprintf(tmp, sizeof(tmp), "\\u%04x", *p);
                        ob_puts(o, tmp);
                    } else {
                        ob_putc(o, (char) *p);
                    }
            }
        }
    }
    ob_putc(o, '"');
}

/* ---- 결과 직렬화 -------------------------------------------------------
 * 반환 포인터는 session 소유이므로 다음 transcribe_run 전에 직렬화를 끝낸다.
 * ---------------------------------------------------------------------- */
static void emit_result(outbuf * o) {
    ob_puts(o, "{\"text\":");
    ob_json_string(o, transcribe_full_text(g_session));

    ob_puts(o, ",\"language\":");
    ob_json_string(o, transcribe_detected_language(g_session));

    ob_puts(o, ",\"segments\":[");
    const int n_seg = transcribe_n_segments(g_session);
    for (int i = 0; i < n_seg; ++i) {
        struct transcribe_segment seg;
        transcribe_segment_init(&seg); /* struct_size 채움 (필수) */
        if (transcribe_get_segment(g_session, i, &seg) != TRANSCRIBE_OK) continue;
        if (i) ob_putc(o, ',');
        char head[128];
        snprintf(head, sizeof(head),
                 "{\"t0_ms\":%lld,\"t1_ms\":%lld,\"speaker_id\":%d,\"text\":",
                 (long long) seg.t0_ms, (long long) seg.t1_ms, (int) seg.speaker_id);
        ob_puts(o, head);
        ob_json_string(o, seg.text);
        ob_putc(o, '}');
    }
    ob_puts(o, "]}");
}

/* ---- HTTP 헬퍼 --------------------------------------------------------- */
static void send_all(int fd, const char * data, size_t n) {
    size_t sent = 0;
    while (sent < n) {
        ssize_t w = write(fd, data + sent, n - sent);
        if (w <= 0) {
            if (errno == EINTR) continue;
            return;
        }
        sent += (size_t) w;
    }
}

static void send_response(int fd, int code, const char * reason,
                          const char * body, size_t body_len) {
    char head[512];
    int  n = snprintf(head, sizeof(head),
                      "HTTP/1.1 %d %s\r\n"
                      "Content-Type: application/json; charset=utf-8\r\n"
                      "Content-Length: %zu\r\n"
                      "Access-Control-Allow-Origin: *\r\n"
                      "Access-Control-Allow-Headers: Content-Type\r\n"
                      "Connection: close\r\n"
                      "\r\n",
                      code, reason, body_len);
    send_all(fd, head, (size_t) n);
    if (body && body_len) send_all(fd, body, body_len);
}

/* 본문 전체를 읽는다. 실패 시 -1, 초과 시 -2. */
static ssize_t read_body(int fd, long content_length, float ** out_pcm) {
    if (content_length <= 0) return -1;
    if (content_length > MAX_BODY) return -2;
    float * pcm = (float *) malloc((size_t) content_length);
    if (!pcm) return -1;
    size_t got = 0;
    while (got < (size_t) content_length) {
        ssize_t r = read(fd, (char *) pcm + got, (size_t) content_length - got);
        if (r < 0) {
            if (errno == EINTR) continue;
            free(pcm);
            return -1;
        }
        if (r == 0) break;
        got += (size_t) r;
    }
    long n_samples = (long) (got / sizeof(float));
    *out_pcm = pcm;
    return n_samples;
}

/* ---- 요청 1건 처리 ----------------------------------------------------- */
static void handle_conn(int fd, const char * language) {
    char reqline[1024];
    size_t used = 0;

    /* 요청 라인 읽기 (\r\n 까지) */
    while (used + 1 < sizeof(reqline)) {
        ssize_t r = read(fd, reqline + used, 1);
        if (r <= 0) break;
        used += (size_t) r;
        if (used >= 2 && reqline[used - 2] == '\r' && reqline[used - 1] == '\n') break;
    }
    reqline[used] = '\0';

    char method[16] = {0};
    char path[512]   = {0};
    if (sscanf(reqline, "%15s %511s", method, path) != 2) {
        send_response(fd, 400, "Bad Request", "{\"error\":\"bad request line\"}", 30);
        return;
    }

    /* 헤더 파싱: Content-Length 만 필요 */
    long content_length = -1;
    for (;;) {
        char line[1024];
        size_t lu = 0;
        while (lu + 1 < sizeof(line)) {
            ssize_t r = read(fd, line + lu, 1);
            if (r <= 0) break;
            lu += (size_t) r;
            if (lu >= 2 && line[lu - 2] == '\r' && line[lu - 1] == '\n') break;
        }
        line[lu] = '\0';
        if (lu <= 2) break; /* 빈 줄 = 헤더 끝 */
        if (strncasecmp(line, "Content-Length:", 15) == 0) {
            content_length = strtol(line + 15, NULL, 10);
        }
    }

    /* --- GET /health --- */
    if (strcmp(method, "GET") == 0 && strcmp(path, "/health") == 0) {
        outbuf o;
        ob_init(&o, 256);
        ob_puts(&o, "{\"ok\":true,\"model\":");
        ob_json_string(&o, g_model_path);
        ob_puts(&o, ",\"language\":");
        ob_json_string(&o, language ? language : "");
        ob_puts(&o, "}");
        send_response(fd, 200, "OK", o.buf, o.len);
        ob_free(&o);
        return;
    }

    /* --- OPTIONS (CORS preflight) --- */
    if (strcmp(method, "OPTIONS") == 0) {
        send_response(fd, 204, "No Content", NULL, 0);
        return;
    }

    /* --- POST /transcribe --- */
    if (strcmp(method, "POST") == 0 && strncmp(path, "/transcribe", 11) == 0) {
        float * pcm = NULL;
        ssize_t n_samples = read_body(fd, content_length, &pcm);

        if (n_samples == -2) {
            send_response(fd, 413, "Payload Too Large",
                          "{\"error\":\"body too large\"}", 26);
            return;
        }
        if (n_samples <= 0) {
            free(pcm);
            send_response(fd, 400, "Bad Request",
                          "{\"error\":\"empty audio\"}", 23);
            return;
        }

        /* 언어 힌트가 있을 때만 구조체를 만든다 (0-초기화 구조체는 기본값이 아님) */
        struct transcribe_run_params rp;
        transcribe_run_params_init(&rp);
        rp.language = language; /* NULL이면 자동 감지 */

        transcribe_status st = transcribe_run(g_session, pcm, (int) n_samples, &rp);
        free(pcm);

        if (st != TRANSCRIBE_OK) {
            outbuf e;
            ob_init(&e, 256);
            ob_puts(&e, "{\"error\":");
            ob_json_string(&e, transcribe_status_string(st));
            ob_puts(&e, "}");
            send_response(fd, 503, "Service Unavailable", e.buf, e.len);
            ob_free(&e);
            return;
        }

        outbuf o;
        ob_init(&o, 64 * 1024);
        emit_result(&o);
        send_response(fd, 200, "OK", o.buf, o.len);
        ob_free(&o);
        return;
    }

    send_response(fd, 404, "Not Found", "{\"error\":\"not found\"}", 21);
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        fprintf(stderr,
                "usage: %s model.gguf [language] [host] [port]\n"
                "  e.g. %s moonshine-base-ko-Q8_0.gguf ko 127.0.0.1 8910\n",
                argv[0], argv[0]);
        return 2;
    }
    g_model_path     = argv[1];
    const char * lang = (argc >= 3 && argv[2][0]) ? argv[2] : NULL;
    const char * host = (argc >= 4) ? argv[3] : "127.0.0.1";
    int          port = (argc >= 5) ? atoi(argv[4]) : 8910;

    signal(SIGPIPE, SIG_IGN); /* 클라이언트 조기 종료로 죽지 않게 */

    if (ensure_session() != 0) return 1;
    fprintf(stderr, "[asr] model loaded: %s\n", g_model_path);
    fflush(stderr);

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); if (g_session) transcribe_close(g_session); return 1; }

    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons((unsigned short) port);
    addr.sin_addr.s_addr = strcmp(host, "0.0.0.0") == 0
                               ? INADDR_ANY
                               : inet_addr(host);

    if (bind(srv, (struct sockaddr *) &addr, sizeof(addr)) < 0) {
        perror("bind");
        if (g_session) transcribe_close(g_session);
        return 1;
    }
    if (listen(srv, 16) < 0) {
        perror("listen");
        if (g_session) transcribe_close(g_session);
        return 1;
    }

    fprintf(stderr, "[asr] listening on http://%s:%d  (POST /transcribe, GET /health)\n",
            host, port);
    fflush(stderr);

    for (;;) {
        int fd = accept(srv, NULL, NULL);
        if (fd < 0) {
            if (errno == EINTR) continue;
            perror("accept");
            break;
        }
        handle_conn(fd, lang);
        close(fd);
    }

    close(srv);
    if (g_session) transcribe_close(g_session);
    return 0;
}
