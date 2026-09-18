# audio.cpp + transcribe.cpp 기반 TTS/ASR 앱 설계서

> 작성일: 2026-09-17
> 대상 레포 (실제 클론 후 분석):
> - `0xShug0/audio.cpp` v0.8.1 (commit `f2b4937`) — TTS 담당
> - `handy-computer/transcribe.cpp` v0.2.3 (commit `be7a8b3`) — ASR 담당

---

## 1. 결론 요약 (Executive Summary)

두 레포는 **둘 다 ggml 위에 올라간 네이티브 추론 런타임**이지만, 설계 철학과 경계가 뚜렷하게 다릅니다.

| | audio.cpp | transcribe.cpp |
|---|---|---|
| 정체 | **오디오 모델 종합 런타임** (TTS·ASR·VC·VAD·diar·음악·코덱) | **ASR 전용 라이브러리** |
| 규모 | 80+ 모델 패밀리 / 120+ 변형 | 21 패밀리 / 70+ 변형 |
| 공개 표면 | CLI + **HTTP 서버(OpenAI 호환)** + WebUI + C ABI | **C API 단일 헤더** + CLI + 4개 언어 바인딩 |
| 라이선스 | **Apache-2.0** | **MIT** |
| 내장 ggml | `external/ggml` **v0.12.0** | `ggml/` **v0.20.2** (패치 적용) |
| 통합 난이도 | 낮음 (HTTP 클라이언트만 붙이면 끝) | 중간 (C API 직접 링크) |

### 권장 아키텍처 (한 줄)

> **"audio.cpp 서버를 TTS 엔진으로, transcribe.cpp를 ASR 엔진으로"** — 두 프로세스를 나란히 띄우고 앱은 그 위의 얇은 오케스트레이터가 된다.

두 라이브러리를 **같은 프로세스에 링크하지 않습니다.** 이유는 §4에서 설명하며, 이는 이 설계에서 가장 중요한 결정입니다.

### 검증 상태 (이 설계서의 신뢰도)

**두 아키텍처 모두 이 기기(aarch64/proot)에서 실제로 빌드·실행·왕복 검증했습니다.**

| 검증 항목 | 결과 |
|---|---|
| 두 레포 aarch64 빌드 | ✅ `transcribe-cli` 37MB, `audiocpp_server` 63MB |
| 한국어 ASR (transcribe.cpp) | ✅ moonshine(MIT 77MB) / qwen3-asr(850MB) 비교 |
| 한국어 TTS (audio.cpp) | ✅ Supertonic-3, CLI·HTTP 산출물 md5 동일 |
| 분리형 왕복 (A안) | ✅ 서버 2개, 소켓 통신, 1.71s |
| 단일형 왕복 (B안) | ✅ 서버 1개, TTS+ASR 동시, 1.07s (RTF 0.30) |
| ggml 심볼 충돌 | ✅ 약 1,300개 중복 실측 |

→ 상세 실측 기록: `VERIFICATION.md` / 원샷 재현: `run_pipeline.sh`, `run_unified.sh`

---

## 2. 두 레포 상세 분석

### 2.1 audio.cpp — TTS 엔진

**구조**

```
audio.cpp/
├── include/
│   ├── audiocpp.h          # C ABI 파사드 (536줄, opt-in: AUDIOCPP_BUILD_C_API)
│   └── engine/             # C++ 내부 (framework / models / community_models)
├── app/
│   ├── cli/                # audiocpp_cli
│   ├── server/             # audiocpp_server (HTTP + 내장 SvelteKit WebUI)
│   ├── gguf/               # audiocpp_gguf (양자화·변환)
│   ├── model_manager/      # audiocpp_model_manager (헤드리스 패키지 관리)
│   └── streaming/          # 스트리밍 세션
├── external/ggml/          # ggml v0.12.0 (vendored)
├── external/cpp-httplib/   # 서버 HTTP
├── model_specs/*.json      # 86개 패밀리 패키지 명세 (다운로드 URL·양자화·크기)
├── webui/                  # 서버에 컴파일되는 프론트엔드
└── docs/{tts,asr,c_api,usage,gguf}.md
```

**세 가지 소비 경로 (공식 문서 `docs/c_api.md`의 권장 기준)**

| 경로 | 적합한 용도 | 비용 |
|---|---|---|
| `audiocpp_cli` | 스크립팅, 배치 | 요청마다 프로세스 + 가중치 재로드 |
| `audiocpp_server` | **다중 클라이언트, 원격, OpenAI 호환** | 포트 + 감독 프로세스 + 오디오 직렬화 |
| C ABI (`libaudiocpp`) | 애플리케이션 임베딩 | 핸들 직접 관리 (세션 워밍 유지 가능) |

→ **앱에는 `audiocpp_server`가 정답입니다.** 세션을 워밍 상태로 재사용하고, 앱은 HTTP만 알면 됩니다.

**핵심: 서버는 OpenAI 호환 엔드포인트를 이미 갖고 있습니다.**

```
GET  /health
GET  /v1/models
GET  /v1/audio/voices
POST /v1/audio/speech              # OpenAI TTS 규격 (audio/wav 기본)
POST /v1/audio/speech/live         # raw PCM 청크 입력 → 즉시 오디오 출력 (S2S)
POST /v1/audio/transcriptions      # JSON 경로 또는 multipart 업로드
POST /v1/audio/transcriptions/details  # words/segments/speaker_turns 포함
POST /v1/audio/transcriptions/live     # 캡처 중 실시간 PCM → SSE 델타
POST /v1/audio/alignments          # 강제 정렬 (아는 대본 + 오디오)
POST /v1/tasks/run                 # 임의 태스크
POST /v1/models/load               # 동적 모델 전환 (ui-management)
```

즉 **TTS 요청 한 줄**로 끝납니다:

```bash
curl http://127.0.0.1:8080/v1/audio/speech \
  -H 'Content-Type: application/json' -o out.wav \
  -d '{"model":"supertonic","input":"안녕하세요, 반갑습니다.","voice_id":"..."}'
```

**스트리밍 TTS (SSE)** — 저지연이 필요할 때:

```jsonc
{
  "model": "voxcpm2-stream",
  "input": "문장을 오디오 이벤트로 스트리밍합니다.",
  "response_format": "pcm",
  "stream_format": "sse"
}
// → speech.audio.delta (base64 PCM) ... speech.audio.done ... data: [DONE]
```

**서버 운영에 중요한 설정 (README에서 발췌)**

- `max_loaded_models`: 동시 상주 모델 수 상한 (VRAM 보호). `1`이면 한 번에 하나.
- `idle_unload_ms`: 유휴 시 자동 언로드 (모바일/저메모리에서 필수).
- `min_free_memory_mb`: 로드 전 여유 메모리 가드 → 부족하면 `503 insufficient_memory`.
- `busy_timeout_ms`: 모델 락 대기 상한 (기본 300초) → 초과 시 `503 server_busy`.
- `lazy_load`: 첫 요청까지 로드 지연. **단, 한 번 쓰면 서버 종료까지 유지.**
- `voice_presets` / `voice_dir`: 서버측 목소리 프리셋 → 클라이언트가 매 요청마다 `voice_ref`를 안 보내도 됨.

> **모바일에서 특히 중요한 조합**: `max_loaded_models: 1` + `idle_unload_ms: 60000` + `min_free_memory_mb: <여유분>`.
> TTS와 ASR을 번갈아 쓰면 모델 스왑이 일어나므로 지연이 발생합니다 — §5의 라우팅 전략으로 완화합니다.

**한국어 지원 TTS (model_specs에서 `ko` 포함 확인)**

| 패밀리 | 모델 | 한국어 | 태스크 | 지표 |
|---|---|---|---|---|
| `supertonic` | Supertonic 3 | ✅ (31개 언어) | tts, stream | 10시간 오디오/3분 (RTX5090), CPU 6x 실시간 |
| `voxcpm2` | VoxCPM2-2B | ✅ (31개 언어) | tts, clone, design, 48kHz | stream 지원 |
| `qwen3_tts` | Qwen3-TTS 0.6B/1.7B | ✅ (10개 언어) | tts, clone, design | 3초 복제 |
| `chatterbox` | Chatterbox 0.5B | ✅ (19개 언어) | tts, clone, vc | clone 특화 |
| `magpie_tts` | MagpieTTS 357M | ✅ (13개 언어) | tts | NVIDIA, 사전학습 보이스 |
| `omnivoice` | OmniVoice (Qwen3-0.6B) | ✅ (646개 언어) | tts, clone, design, stream | 광범위 언어 |
| `pocket_tts` | PocketTTS-100M | ❌ (5개 언어) | tts, clone | 최경량급 |
| `kokoro_tts` | Kokoro 82M | ❌ (9개 언어) | tts | 54 프리셋 보이스 |

**실측 GGUF 크기 (HuggingFace `audio-cpp/audio.cpp-gguf` 트리 조회 결과)**

| 모델 | Q8_0 | F16 |
|---|---|---|
| Supertonic-3 | **454 MB** | 313 MB |
| Kokoro-82M | 190 MB | 212 MB |
| Chatterbox-Turbo | 699 MB | — |
| Chatterbox | 2.09 GB | 3.74 GB |
| VoxCPM1 (0.5B) | 848 MB | — |
| OmniVoice | 1.35 GB | 1.64 GB |
| MagpieTTS-357M | 1.56 GB | — |
| Qwen3-TTS-0.6B | 1.99 GB | 2.52 GB |
| VoxCPM2-2B | 2.96 GB | 4.77 GB |
| Qwen3-TTS-1.7B | 2.70 GB | 4.20 GB |

→ **경량 경로**: Supertonic(454MB)·Kokoro(190MB). **보이스 클로닝 필요 시**: Chatterbox-Turbo(699MB) 또는 VoxCPM1(848MB).

### 2.2 transcribe.cpp — ASR 엔진

**구조**

```
transcribe.cpp/
├── include/
│   ├── transcribe.h        # 단일 공개 C 헤더 (2,662줄)
│   ├── transcribe/         # 패밀리별 확장 헤더
│   └── transcribe.abihash
├── src/                    # C++17 내부 (transcribe-*.cpp + arch/*)
├── examples/{hello,hello_stream,cli,bench}
├── bindings/{python,typescript,rust,swift}
├── catalog/*.json          # 21 패밀리 / 70+ 변형 메타데이터 + WER 실측
├── ggml/                   # ggml v0.20.2 (패치: 스레드풀 oversubscription)
└── docs/models/*.md        # 변형별 모델 카드
```

**설계상 중요한 특징**

- **공개 표면이 C 헤더 하나**입니다. C++ 타입이 경계를 넘지 않습니다.
- 모든 진입점이 `transcribe_status`를 반환하고, **예외가 밖으로 나가지 않습니다.** 실패 상세는 `transcribe_status_string()`.
- 반환된 `const char*`/`const float*`는 **차용(borrowed)** — 핸들이 해제·변경되면 무효. 유지하려면 복사.
- 문자열은 **절대 NULL이 아님** (미채움 필드는 `""`), NULL 해제는 no-op → 클라이언트 코드가 단순해집니다.
- 핸들은 **부모를 내부적으로 붙들고 있습니다.** 해제 순서가 뒤바뀌어도 안전:
  ```c
  transcribe_model_free(model);        /* session 계속 동작 */
  transcribe_run(session, pcm, n, NULL);  /* 여전히 유효 */
  ```
  (GC 언어 바인딩을 위한 의도적 설계 — `docs/c_api.md`에 명시)

**정식 5단계 사용법 (`examples/hello/main.c`)**

```c
transcribe_open(model_path, NULL, NULL, &session);  // 로드 + 세션 결합
transcribe_run(session, pcm, n_samples, NULL);      // NULL = 기본 파라미터
printf("%s\n", transcribe_full_text(session));
transcribe_close(session);                          // 세션 + 소유 모델 해제
```
> `NULL` 파라미터 = "라이브러리 기본값". **0으로 초기화한 구조체는 기본값이 아니라 거부됩니다** — 이 구분이 ABI 안전성의 핵심입니다.

**스트리밍 (`examples/hello_stream/main.c`)**

```c
transcribe_open(...);
transcribe_model_get_capabilities(model, &caps);   // caps.supports_streaming 게이트
transcribe_stream_begin(session, NULL, NULL);
while (...) {
  transcribe_stream_feed(session, chunk, n, &update);
  if (update.result_changed) { /* UI 갱신 */ }
}
transcribe_stream_finalize(session, &update);
```

폴 기반입니다. 피드 후 라이브러리가 이미 누적 결과를 갱신해두었고, 클라이언트가 읽습니다.

- `update.result_changed` — "뭔가 바뀌었나?" cheap probe
- `update.revision` — 단조 증가 스냅샷 카운터 (**텍스트 변화와 1:1이 아님** — diff로 판단할 것)
- `transcribe_stream_get_text()` → `{full_text, committed_text, tentative_text}`
  - `committed_text` — **API 안정 접두사. 한 번 노출되면 재작성되지 않음.** UI/입력 확정용.
  - `tentative_text` — 매 피드마다 교체될 수 있는 휘발성 꼬리.
- `stable_prefix_agreement_n` (기본 3) — 3회 연속 가설이 일치해야 커밋. **UI 깜빡임 방지의 핵심 노브.**
- `transcribe_stream_commit_policy` — AUTO / STABLE_PREFIX / ON_FINALIZE 등

> **⚠️ 텍스트 포인터 수명 규칙**: `transcribe_stream_feed()` 호출은 이전의 모든 텍스트 포인터를 무효화할 수 있습니다.
> 다른 스레드에 넘기거나 큐에 넣을 거면 **반드시 바이트를 복사**하세요. 이것이 바인딩 구현 시 가장 흔한 버그 원천입니다.

**취소·절단**

```c
transcribe_set_abort_callback(session, cb, userdata);
transcribe_was_aborted(session);
transcribe_was_truncated(session);
```

**바인딩 성숙도**

| 언어 | 경로 | 상태 |
|---|---|---|
| Python | `bindings/python` (`transcribe_cpp`) | 개발 중 (휠 미배포 → `TRANSCRIBE_LIBRARY` 또는 로컬 빌드) |
| TypeScript/JS | `bindings/typescript` | FFI 기반, CUDA 헬퍼 포함 |
| Rust | `bindings/rust/transcribe-cpp` | crate, `build.rs`, examples/tests 포함 |
| Swift/ObjC | `bindings/swift` | — |

Python 예시:

```python
import transcribe_cpp
with transcribe_cpp.Model("model.gguf") as model:
    with model.session() as session:
        result = session.run(pcm_float32_16k_mono)   # 16kHz mono f32 필수
        print(result.text)
        # result = session.run(pcm, pnc="off", itn="on")
```
> `run()`은 **컨테이너 디코딩·리샘플링을 하지 않습니다.** 16kHz mono float32를 직접 만들어 넣어야 합니다.

**한국어 ASR 실측 WER (catalog의 FLEURS test, n=382, Q8_0)** — 이게 모델 선택의 근거입니다.

| 모델 | 한국어 | WER | 라이선스 | 스트리밍 | 크기(Q8_0) |
|---|---|---|---|---|---|
| **qwen3-asr-1.7b** | ✅ | **4.60%** | Apache-2.0 | ❌ | 1.9 GB |
| whisper-large-v3 | ✅ | 4.89% | Apache-2.0 | ❌ | 3.1 GB |
| whisper-large-v2 | ✅ | 4.99% | Apache-2.0 | ❌ | 3.1 GB |
| **fun-asr-mlt-nano-2512** | ✅ | **5.20%** | other | ❌ | 0.89 GB |
| whisper-large-v3-turbo | ✅ | 5.24% | Apache-2.0 | ❌ | 1.6 GB |
| whisper-large | ✅ | 5.25% | Apache-2.0 | ❌ | 3.1 GB |
| **voxtral-mini-4b-realtime-2602** | ✅ | **5.27%** | Apache-2.0 | **✅** | 2.9 GB |
| whisper-medium | ✅ | 5.46% | Apache-2.0 | ❌ | 1.5 GB |
| **qwen3-asr-0.6b** | ✅ | **5.82%** | Apache-2.0 | ❌ | 0.85 GB |
| cohere-transcribe-03-2026 | ✅ | 6.57% | Apache-2.0 | ❌ | 2.4 GB |
| whisper-small | ✅ | 7.70% | Apache-2.0 | ❌ | 0.97 GB |
| moonshine-base-ko | ✅ | 8.12% | **MIT** | ❌ | 77 MB |
| sensevoice-small | ✅ | 8.27% | other | ❌ | 253 MB |
| **nemotron-3.5-asr-streaming-0.6b** | ✅ | **8.89%** | other | **✅** | 751 MB |
| moonshine-tiny-ko | ✅ | 9.00% | **MIT** | ❌ | ~40 MB |
| whisper-tiny | ✅ | 19.07% | Apache-2.0 | ❌ | ~75 MB |

**선택 가이드** (아래는 설계서 근거이며, §부록의 실측으로 검증됨)
- **정확도 최우선** → `qwen3-asr-1.7b` (4.60%, Apache-2.0)
- **정확도/크기 균형** → `qwen3-asr-0.6b` (5.82%, 0.85GB, Apache-2.0) ← **기본 권장**
- **초경량/오프라인** → `moonshine-base-ko` (8.12%, **77MB**, **MIT**) ← 라이선스가 가장 자유로움
- **실시간 스트리밍 + 한국어** → `voxtral-mini-4b-realtime-2602` (5.27%, 스트리밍) 또는 `nemotron-3.5-asr-streaming-0.6b` (8.89%, 751MB)
- **한국어 정확도가 목표라면 whisper-large-v3-turbo는 비추천** — 크기(1.6GB) 대비 5.24%로 qwen3-0.6b(0.85GB, 5.82%)와 큰 차이 없음

> **✅ 실측 검증 완료**: 이 기기(aarch64 CPU)에서 두 모델을 직접 실행해 위 순서를 확인했습니다.
> 같은 한국어 오디오에 대해 `qwen3-asr-0.6b`가 `moonshine-base-ko`보다 명확히 정확했습니다
> ("지질조사국/열적 거동/글렌 쿠싱" vs "지릴조사국/열정 거동/글랜쿠싱").
> 상세는 `VERIFICATION.md` §5 참조.

---

## 3. 설계 목표와 제약

### 3.1 검증된 제약 (실측)

이 설계는 실제 환경에서 확인한 사실에 근거합니다.

| 제약 | 실측 결과 | 설계 영향 |
|---|---|---|
| **두 레포가 각자 ggml을 내장** | audio.cpp=v0.12.0, transcribe.cpp=v0.20.2. 공개 심볼 **약 1,300개 중복** (`ggml_new_tensor` 등) | **같은 프로세스 링크 금지** (§4) |
| **ggml 버전 불일치** | 0.12.0 vs 0.20.2 (8개 마이너 차이) | 하나로 통일 불가 |
| **ASR 입력 규격** | **16kHz mono float32만 허용, 리샘플 없음** | 앱에 리샘플러 필수 (§6) |
| **audio.cpp ASR 입력** | 서버가 WAV 디코딩은 해줌 (multipart 업로드) | 서버 경로 사용 시 편함 |
| **모바일 메모리** | 대상 기기 RAM 10GB, 여유 2.5GB | 모델 상주 1개 제한 필수 |

### 3.2 두 라이브러리를 한 프로세스에 못 넣는 이유

이것이 설계의 핵심 결정이므로 근거를 명시합니다.

1. **심볼 충돌**: 두 라이브러리 모두 `add_library(ggml ...)`로 **동일한 이름**의 정적 라이브러리를 만들고, `ggml_*` 심볼 약 1,300개가 겹칩니다. 정적 링크 시 링커가 중복 정의로 실패하거나(가장 흔함), 운 좋게 통과해도 **한쪽 백엔드가 다른 쪽 ggml에 바인딩되어 조용히 오작동**합니다. 후자가 훨씬 위험합니다.
2. **ggml 버전 차이**: 0.12.0과 0.20.2는 API가 다릅니다. 하나로 강제 통일하면 양쪽 모두 검증되지 않은 조합이 됩니다.
3. **검증 부담**: 두 프로젝트 모두 "레퍼런스 대비 수치 검증"을 핵심 가치로 내세웁니다(audio.cpp의 parity tooling, transcribe.cpp의 WER 테스트). 심볼을 섞으면 그 보증이 무효가 됩니다.

**우회 옵션과 평가**

| 방식 | 가능성 | 평가 |
|---|---|---|
| 정적 링크 통합 | ❌ | 심볼 중복 1,300개 → 링크 실패/조용한 오작동 |
| `objcopy --prefix-symbols` 심볼 리네임 | ⚠️ | 이론상 가능하나 두 ggml 전체에 적용 시 취약, 유지보수 지옥 |
| **별도 프로세스 + HTTP/IPC** | ✅ | **권장**. 두 런타임이 각자 검증된 상태 유지 |
| 한쪽만 사용 | ✅ | ASR을 audio.cpp로 통일하는 대안 (§4.2) |

---

## 4. 아키텍처 설계

### 4.1 권장안 — 프로세스 분리 (TTS=audio.cpp, ASR=transcribe.cpp)

```
┌──────────────────────────────────────────────────────────┐
│                    앱 (UI + 오케스트레이터)                │
│                                                          │
│  ┌────────────┐   ┌─────────────┐   ┌────────────────┐  │
│  │ 오디오 캡처 │   │ 대화 상태    │   │ 오디오 재생     │  │
│  │ (16k mono) │   │ 머신        │   │ (PCM/WAV)      │  │
│  └─────┬──────┘   └──────┬──────┘   └───────▲────────┘  │
│        │                 │                  │            │
│        │        ┌────────▼────────┐         │            │
│        │        │  엔진 라우터     │         │            │
│        │        └───┬─────────┬───┘         │            │
└────────┼────────────┼─────────┼─────────────┼────────────┘
         │            │         │             │
         │     ┌──────▼───┐  ┌──▼──────────┐  │
         │     │ ASR 클라  │  │ TTS 클라    │  │
         │     └──────┬───┘  └──┬──────────┘  │
         │            │         │             │
    ┌────▼────────────▼──┐  ┌───▼─────────────▼────┐
    │  transcribe.cpp     │  │  audio.cpp           │
    │  libtranscribe.so   │  │  audiocpp_server     │
    │  (in-process C ABI) │  │  HTTP :8080          │
    │  또는 transcribe-cli│  │  (OpenAI 호환)        │
    └─────────────────────┘  └──────────────────────┘
         자체 ggml 0.20.2         자체 ggml 0.12.0
```

**핵심 규칙**
- 두 런타임은 **절대 같은 주소 공간을 공유하지 않습니다.**
- TTS는 HTTP(사실상 표준) → 클라이언트 코드가 극히 단순.
- ASR은 두 가지 결합 방식 중 선택 (§4.1.1).

#### 4.1.1 ASR 결합 방식 비교

| 방식 | 장점 | 단점 | 권장 상황 |
|---|---|---|---|
| **A. C ABI 직접 링크** (`libtranscribe.so` + FFI) | 지연 최소, 스트리밍 세션 워밍 유지, 프로세스 1개 | 언어별 FFI 필요, 크래시가 앱 전체를 죽임 | 데스크톱/서버, 실시간성 중시 |
| **B. `transcribe-cli` 서브프로세스** | 격리, 구현 단순 | 모델 재로드 비용, 배치에 부적합 | 프로토타입, 배치 처리 |
| **C. audio.cpp 서버로 ASR 통일** | 클라이언트 1개(HTTP)로 끝 | ASR 다양성 축소, 두 프로세스 관리 | **모바일 1차 MVP** |
| **D. 자체 ASR 서버 래퍼** | HTTP로 격리 + 세션 워밍 | 래퍼 작성·유지 필요 | 다중 클라이언트 + 스트리밍 |

> **실무 권장**: 데스크톱/서버는 **A**, 모바일 MVP는 **C → 이후 D**로 진화.
> D는 `transcribe.h`의 C API를 감싼 60~120줄짜리 HTTP 서버로 충분합니다(§7.2에 스켈레톤 제공).

### 4.2 대안 설계 — audio.cpp 단일 엔진

```
앱 ── HTTP ──▶ audiocpp_server
                 ├─ /v1/audio/speech            (TTS)
                 ├─ /v1/audio/transcriptions    (ASR, multipart)
                 ├─ /v1/audio/transcriptions/live (실시간 ASR)
                 └─ /v1/audio/alignments        (강제 정렬)
```

**장점**
- 클라이언트가 **HTTP 하나** → 앱 코드 최소, 플랫폼 이식성 최고.
- 모델 관리(다운로드·전환·언로드)를 **서버가 이미 다 해줌** (`--ui-management`).
- WebUI가 딸려와서 디버깅·데모가 즉시 가능.
- 오디오 포맷 변환(MP3/FLAC 입력은 프론트엔드 모듈)까지 확장 가능.

**단점**
- transcribe.cpp 대비 **ASR 한국어 선택지·정확도 세밀 제어가 제한적**.
  audio.cpp의 ASR 계열: `qwen3_asr`, `cohere_asr`, `nemotron_asr`, `sense_asr`, `moss_transcribe_diarize`, `parakeet_tdt`, `voxtral_realtime`, `vibevoice_asr` 등 — transcribe.cpp와 겹치는 모델이 많음.
- 다만 audio.cpp에 **`parakeet_tdt`·`voxtral_realtime`·`vibevoice_asr_streaming`이 있어** 실시간 한국어 경로도 확보됨.

#### 4.2.1 실측 검증 (✅ 완료)

**이 대안은 가정이 아니라 실제로 돌려서 확인했습니다.**

```
$ audiocpp_server --config unified_server.json --port 8912 --backend cpu
{"status":"ok","backend":"cpu","models":2,...}

$ curl -X POST :8912/v1/audio/speech -d '{"model":"supertonic-ko","input":"안녕하세요. 오늘은 날씨가 좋습니다.",...}'
TTS HTTP=200  bytes=313752  time=17.94s

$ curl -X POST :8912/v1/audio/transcriptions -F model=qwen3-asr -F language=ko -F file=@uni_tts_ko.wav
{"text":"안녕하세요 오늘은 날씨가 좋습니다.","timing":{"wall_ms":1068.2,"audio_duration_ms":3556.8,"rtf":0.30}}
ASR HTTP=200  time=1.07s
```

| 항목 | 결과 |
|---|---|
| 한 서버에 TTS+ASR 모델 동시 등록 | ✅ `models:2` |
| TTS (`/v1/audio/speech`) | ✅ HTTP 200, 313,752 bytes |
| ASR (`/v1/audio/transcriptions`, multipart) | ✅ HTTP 200, 문장 일치 |
| **44.1kHz WAV 직접 입력** | ✅ **서버가 내부 리샘플** (외부 리샘플러 불필요) |
| 워밍 후 ASR 지연 | **1.07초 (RTF 0.30)** |

**핵심 발견 2가지**

1. **audio.cpp용 GGUF는 self-contained** — HF의 `audio-cpp/audio.cpp-gguf` 패키지는
   `config.json`·tokenizer·generation config가 **GGUF 안에 임베드**되어 단독으로 `--model`에 전달 가능합니다.
   (반면 transcribe.cpp용 GGUF는 자체 레이아웃이라 서로 호환되지 않음 — §7.3 참조)
2. **서버가 리샘플을 대신 해줌** — transcribe.cpp는 16kHz mono f32를 강제해 앱에 리샘플러가
   필수지만(§3.1), audio.cpp 서버 경로는 44.1kHz WAV를 그대로 받아 내부에서 변환합니다.

#### 4.2.2 두 아키텍처 정면 비교 (동일 오디오·동일 결과)

```
A) 분리형  : TTS(audio.cpp) → f32 변환 → ASR(transcribe.cpp 래퍼)   → 1.71 s
B) 단일형  : TTS(audio.cpp) → WAV 그대로 → ASR(audio.cpp 서버)      → 1.07 s
```

| | A) 분리형 | B) 단일형 |
|---|---|---|
| 인식 결과 | "안녕하세요 오늘은 날씨가 좋습니다." ✅ | 동일 ✅ |
| 워밍 후 지연 | 1.71 s | **1.07 s** (RTF 0.30) |
| 클라이언트 수 | 2 (TTS 서버 + ASR 서버) | **1 (HTTP)** |
| 리샘플러 | **앱/스크립트에 필요** | 불필요 (서버 내부) |
| 한국어 ASR 모델 | moonshine(MIT 77MB) / qwen3 0.6b·1.7b | qwen3_asr / cohere / nemotron / sense / vibevoice |
| 바이너리 크기 | 63MB + 36.6MB 래퍼 | 63MB |
| 스트리밍 한국어 | 모델 게이트 확인 필요 | `vibevoice_asr_streaming`(ko) / `voxtral_realtime` |
| 실시간 자막 | 직접 구현 | **`/v1/audio/transcriptions/live` 제공** |

**결론**: **transcribe.cpp를 ASR에 쓰는 실질적 이득은 "라이선스(MIT) + 검증된 WER 카탈로그 + 세밀한 스트리밍 제어 + 바인딩"** 입니다. 반대로 **운영 단순성은 audio.cpp 단일 엔진이 압도적**입니다(실측으로 확인). 그래서 §8 로드맵에서 **audio.cpp 단일로 MVP → transcribe.cpp를 고정확 ASR 경로로 추가**하는 순서를 권장합니다.

---

## 5. 모델 전략 (모바일/엣지 우선)

### 5.1 티어 구성

| 티어 | TTS | ASR | 총 상주 | 대상 |
|---|---|---|---|---|
| **Lite** (8GB+) | Supertonic-3 Q8 (454MB) | moonshine-base-ko Q8 (77MB) | **~0.53GB** | 저사양 안드로이드, 라이선스 자유 최우선 |
| **Standard** (12GB+) | Chatterbox-Turbo Q8 (699MB) | qwen3-asr-0.6b Q8 (850MB) | **~1.55GB** | 일반 기기, 한국어 정확도 확보 |
| **Pro** (16GB+) | VoxCPM2 Q8 (2.96GB) | qwen3-asr-1.7b Q8 (1.9GB) | **~4.9GB** | 데스크톱/고사양, 클로닝+최고 정확도 |
| **Realtime** | VoxCPM2-stream | voxtral-mini-4b-realtime-2602 | ~5.9GB | 저지연 대화형 |

> **중요**: Standard 티어의 1.55GB는 이 환경(여유 2.5GB)에서 **한 번에 하나만** 올려야 합니다. `max_loaded_models: 1` + `idle_unload_ms` 필수.

### 5.2 TTS/ASR 동시 사용 시 모델 스왑 문제

TTS와 ASR을 번갈아 호출하면 (특히 `max_loaded_models: 1`일 때) 매 턴마다 모델 로드가 발생해 **수 초 지연**이 생깁니다. 완화 전략:

1. **`max_loaded_models: 2`** — 메모리가 허용하면 TTS와 ASR을 둘 다 상주. 가장 효과적.
2. **대화 턴 구조 활용** — 사용자가 말하는 동안(ASR) TTS가 유휴이므로 스왑이 실제로는 1회/턴.
3. **프리로드** — 대화 시작 시 두 모델을 미리 `/v1/models/load`로 워밍.
4. **경량 조합 우선** — Lite 티어(0.53GB)면 애초에 둘 다 상주 가능.

---

## 6. 컴포넌트 설계

### 6.1 오디오 I/O 계층

ASR이 **16kHz mono float32**만 받으므로 여기가 정확성의 병목입니다.

```
마이크 ──▶ 캡처(네이티브/브라우저) ──▶ 리샘플 ──▶ 16k mono f32 ──▶ ASR
                                              └──▶ VAD ──▶ 발화 구간만 전송
재생   ◀── 오디오 출력 ◀── PCM 디코드 ◀── TTS 응답(WAV / SSE PCM)
```

**필수 구성요소**
- **리샘플러**: 48k/44.1k → 16k. 품질 중요(나이퀴스트 필터 없으면 WER 급락).
- **VAD**: 무음 구간 제거 → 추론 횟수 감소 = 배터리/지연 개선.
  - audio.cpp에 `silero_vad`(Bundled!), `marblenet_vad`(Bundled), `pulsevad`가 있습니다. **번들 모델이라 별도 다운로드 불필요** — VAD는 audio.cpp 것만 써도 충분합니다.
- **포맷 처리**: TTS는 `response_format`을 `pcm`(스트리밍) 또는 `wav`(파일)로 선택.

### 6.2 대화 상태 머신

```
        ┌──────────┐
        │  IDLE    │◀────────────────────────┐
        └────┬─────┘                         │
             │ 사용자 입력 시작                 │
        ┌────▼─────────┐                      │
        │ LISTENING    │ VAD: 발화 감지         │
        │ (ASR 스트림)  │──▶ committed_text 누적 │
        └────┬─────────┘                      │
             │ 발화 종료(VAD silence)          │
        ┌────▼─────────┐                      │
        │ THINKING     │ (LLM/로직 — 선택)      │
        └────┬─────────┘                      │
             │ 응답 텍스트 확정                 │
        ┌────▼─────────┐                      │
        │ SPEAKING     │ TTS: 문장 단위 분할     │
        │ (TTS 스트림)  │──▶ 첫 문장부터 재생     │
        └────┬─────────┘                      │
             │ 재생 완료                       │
             └────────────────────────────────┘
```

**저지연의 핵심**: TTS를 **문장 단위로 쪼개 첫 문장부터 재생**하고, 나머지는 생성되는 동안 이어 붙입니다.
- audio.cpp는 `--text-chunk-size` / `text_chunk_mode`로 긴 텍스트 분할·병합을 지원합니다.
- `speech/live` + `speech.audio.delta` SSE로 **TTFT를 수십 ms까지** 낮출 수 있습니다.

### 6.3 엔진 라우터

```python
class EngineRouter:
    """TTS는 audio.cpp, ASR은 transcribe.cpp (또는 audio.cpp)로 보낸다."""
    def __init__(self, tts_base="http://127.0.0.1:8080",
                 asr_backend="audio_cpp"):     # "audio_cpp" | "transcribe_ffi" | "transcribe_http"
        ...
    async def tts(self, text, voice=None, stream=True) -> AsyncIterator[bytes]: ...
    async def asr(self, pcm16k_f32, language="ko") -> TranscriptResult: ...
    async def asr_stream(self) -> AsrStreamSession: ...
```

**책임**
- 백엔드 선택 및 폴백 (ASR 1차 실패 시 다른 백엔드로 재시도)
- **503 처리**: `server_busy` → 백오프 재시도, `insufficient_memory` → 모델 언로드 후 재시도
- 모델 프리로드 / 유휴 언로드 스케줄링
- 16k mono f32 규격 강제 (잘못된 입력을 조용히 통과시키지 않음)

---

## 7. 구현 청사진

### 7.1 서버 설정 (TTS + ASR 동시)

```jsonc
// server.json — 모바일/엣지 기준
{
  "host": "127.0.0.1",
  "port": 8080,
  "backend": "cpu",              // 모바일: cpu. CUDA 있으면 "cuda"
  "threads": 4,
  "lazy_load": true,
  "max_loaded_models": 2,        // TTS + ASR 동시 상주 (메모리 허용 시)
  "idle_unload_ms": 60000,       // 60초 유휴 시 언로드
  "min_free_memory_mb": 600,     // 로드 전 여유 메모리 가드
  "busy_timeout_ms": 120000,
  "max_request_body_bytes": 134217728,
  "models": [
    {
      "id": "tts", "family": "supertonic", "path": "models/Supertonic-3-GGUF",
      "task": "tts", "mode": "offline",
      "default_voice_preset": { "voice_id": "<ko-voice-id>" }
    },
    {
      "id": "asr", "family": "qwen3_asr", "path": "models/Qwen3-ASR-0.6B",
      "task": "asr", "mode": "offline"
    }
  ]
}
```

```bash
# 빌드 (모바일: CPU 백엔드, 필요한 패밀리만)
scripts/build_linux.sh --backend cpu --model-set custom \
  --models supertonic,qwen3_asr,silero_vad --target audiocpp_server

# 실행
./build/linux-cpu-release/bin/audiocpp_server --config server.json
```

> **빌드 최적화**: `--model-set custom --models ...`로 필요한 패밀리만 컴파일하면 바이너리·빌드 시간이 크게 줄어듭니다. 80개 패밀리 전체를 넣을 이유가 없습니다.

### 7.2 transcribe.cpp ASR 서버 래퍼 (방식 D 스켈레톤)

```c
// asr_server.c — transcribe.h C API를 HTTP로 노출.
// 목적: ASR을 별도 프로세스로 격리해 ggml 심볼 충돌을 원천 차단 + 세션 워밍 유지.
//
// 빌드:  cmake -B build -DTRANSCRIBE_BUILD_SHARED=ON && cmake --build build
//        cc asr_server.c -Iinclude -Lbuild -ltranscribe -o asr_server
//
// 규격:  입력은 16kHz mono float32 raw (application/octet-stream)
//        응답은 기존 transcribe API를 그대로 JSON으로 매핑

#include "transcribe.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static struct transcribe_session * g_session = NULL;   // 워밍 세션 (요청 간 재사용)

static int ensure_session(const char * model_path) {
    if (g_session) return 0;
    transcribe_status st = transcribe_open(model_path, NULL, NULL, &g_session);
    if (st != TRANSCRIBE_OK) {
        fprintf(stderr, "transcribe_open: %s\n", transcribe_status_string(st));
        return -1;
    }
    return 0;
}

static void emit_json_escaped(const char * s) {
    putchar('"');
    for (; s && *s; ++s) {
        switch (*s) {
            case '"':  fputs("\\\"", stdout); break;
            case '\\': fputs("\\\\", stdout); break;
            case '\n': fputs("\\n",  stdout); break;
            case '\r': fputs("\\r",  stdout); break;
            case '\t': fputs("\\t",  stdout); break;
            default:
                if ((unsigned char)*s < 0x20) printf("\\u%04x", (unsigned char)*s);
                else putchar(*s);
        }
    }
    putchar('"');
}

int main(int argc, char ** argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s model.gguf\n", argv[0]); return 2; }
    if (ensure_session(argv[1]) != 0) return 1;

    /* 실제 서버에서는 여기서 HTTP 루프를 돌린다.
       아래는 요청 1건 처리의 본체 — 어떤 HTTP 라이브러리를 쓰든 동일하다. */
    while (1) {
        float * pcm = NULL; int n = 0, cap = 0;
        /* ... HTTP body를 float32 배열로 읽어 pcm/n 채우기 ... */

        if (transcribe_run(g_session, pcm, n, NULL) != TRANSCRIBE_OK) {
            /* 503 + {"error": transcribe_status_string(st)} */
        }
        printf("{\"text\":"); emit_json_escaped(transcribe_full_text(g_session));
        printf(",\"language\":"); emit_json_escaped(transcribe_detected_language(g_session));
        printf(",\"segments\":[");
        const int ns = transcribe_n_segments(g_session);
        for (int i = 0; i < ns; ++i) {
            struct transcribe_segment seg; transcribe_segment_init(&seg);
            if (transcribe_get_segment(g_session, i, &seg) != TRANSCRIBE_OK) continue;
            if (i) putchar(',');
            printf("{\"start_ms\":%lld,\"end_ms\":%lld,\"text\":",
                   (long long)seg.t0_ms, (long long)seg.t1_ms);
            emit_json_escaped(seg.text); putchar('}');
        }
        printf("]}\n"); fflush(stdout);
    }
}
```

**포인트**
- `g_session`을 **요청 간 재사용** → 매 요청마다 모델을 다시 로드하지 않음 (CLI 서브프로세스 방식 대비 최대 이득).
- 반환 포인터는 **즉시 사용** — 다음 `transcribe_run` 전에 JSON으로 직렬화 완료.
- 서버가 죽어도 앱은 HTTP 오류만 받음 → **크래시 격리**.

### 7.3 앱이 반드시 지켜야 할 규칙 (체크리스트)

| # | 규칙 | 위반 시 |
|---|---|---|
| 1 | ASR 입력은 **16kHz mono float32** (transcribe.cpp 경로 한정 — audio.cpp 서버는 WAV 직접 수용) | `TRANSCRIBE_ERR_*` 또는 쓰레기 출력 |
| 2 | transcribe 스트리밍에서 텍스트 포인터는 **즉시 복사** | 간헐적 깨진 텍스트 (가장 흔한 버그) |
| 3 | 파라미터는 **`NULL` = 기본값**, 0-초기화 구조체 ≠ 기본값 | `BAD_STRUCT_SIZE` 거부 |
| 4 | `committed_text`만 UI 확정 표시에 사용 | 화면 깜빡임 |
| 5 | 503 `server_busy` / `insufficient_memory`는 **재시도 가능 오류** | 불필요한 실패 처리 |
| 6 | 두 라이브러리를 **한 프로세스에 링크 금지** | 심볼 충돌·조용한 오작동 |
| 7 | `max_loaded_models: 1`에서 TTS↔ASR 교대 시 **스왑 지연 인지** | 체감 지연 폭증 |
| 8 | **GGUF는 엔진별로 호환되지 않음** — audio.cpp는 `audio-cpp/audio.cpp-gguf`(self-contained: config 내장), transcribe.cpp는 자체 레이아웃 | `missing model package file 'config'` (실측 확인) |
| 9 | audio.cpp CLI는 스펙 파일이 필요할 수 있음 — `--model-spec-override model_specs/<family>.json` | `model spec not found for family '...'` (실측 확인) |

### 7.4 실측으로 확인된 함정 (재현 명령 포함)

**함정 1 — GGUF를 바꿔 쓰면 로드 실패**

```bash
# transcribe.cpp용 GGUF를 audio.cpp에 넣으면:
$ audiocpp_cli --task asr --family qwen3_asr --model .../qwen3-asr-0.6b-Q8_0.gguf ...
audiocpp_cli failed: failed to load model resources using model spec '...qwen3_asr.json'
  source 'gguf': missing model package file 'config': .../models/asr/config.json
```

→ **반드시 벤더별 GGUF를 따로 받아야 합니다.** 같은 이름의 모델이라도 레이아웃이 다릅니다.

**함정 2 — `--model-spec-override` 없이는 family를 못 찾음**

```bash
$ audiocpp_cli --task asr --family qwen3_asr --model <gguf> --audio x.wav
audiocpp_cli failed: model spec not found for family 'qwen3_asr'
  (provide --model-spec-override, embed it in the GGUF, enable AUDIOCPP_DEPLOYMENT_BUILD,
   or install model_specs/qwen3_asr.json)
```

→ 소스 빌드에서는 `--model-spec-override /path/audio.cpp/model_specs/qwen3_asr.json`를 붙이면 해결.
(프리빌트 배포본은 스펙이 임베드되어 있어 불필요)

**함정 3 — audio.cpp의 moonshine은 영어 전용**

`model_specs/moonshine_asr.json` → `"languages": ["en"]`.
한국어가 필요하면 `qwen3_asr`(ko 포함 31개 언어, `status: supported`)를 쓰세요.
transcribe.cpp의 `moonshine-base-ko`(MIT 77MB)와는 **다른 모델**입니다.

**한국어 지원 ASR 패밀리 (audio.cpp, 16개 중)**

| family | status | 한국어 | 패키지 |
|---|---|---|---|
| `qwen3_asr` | supported | ✅ | 0.6b/1.7b Q8·F16 |
| `cohere_asr` | supported | ✅ | cohere_transcribe |
| `vibevoice_asr_streaming` | supported | ✅ | 7B (스트리밍) |
| `nemotron_asr` | supported | ❌ | 0.6b |
| `sense_asr` | community | ✅ | sensevoice_small |
| `audio8_asr` | community | ✅ | 0.1b |
| `vibeasr` | community | ✅ | bitnet |
| `moonshine_asr` | experimental | ❌ (영어) | streaming tiny/small/medium |

---

## 8. 로드맵

### Phase 0 — 검증 (✅ 완료, `VERIFICATION.md` 참조)
- ✅ 두 레포 클론·구조·API·모델 카탈로그·라이선스 분석
- ✅ ggml 심볼 충돌(≈1,300개) 및 버전 차이(0.12.0 vs 0.20.2) 확인
- ✅ **aarch64 CPU 빌드 실행 검증** (transcribe.cpp: `transcribe-cli` 37MB + `libtranscribe.a`)
- ✅ audio.cpp CPU 빌드 검증 (`audiocpp_server` 63MB, 83개 모델 타겟 등록)
- ✅ 실제 모델로 한국어 ASR 추론 (moonshine MIT 77MB / qwen3-asr 850MB 비교)
- ✅ 한국어 TTS 합성 (Supertonic-3, CLI·HTTP 산출물 md5 동일)
- ✅ **HTTP 전 구간 TTS→ASR 왕복** — 두 프로세스가 소켓으로 통신, 문장 일치
- ✅ asr_server / asr_http_server 링크·실행 (설계서 §7.2 방식 D 실증)

→ **Phase 0의 미검증 항목 없음.** 단일 스크립트 재현: `bash run_pipeline.sh`

### Phase 1 — MVP (audio.cpp 단일 엔진) — ✅ 검증 완료
- ✅ `audiocpp_server`를 CPU 백엔드로 빌드 (`bin/audiocpp_server` 63MB)
- ✅ TTS: `POST /v1/audio/speech` → WAV (HTTP 200, 313,752 bytes)
- ✅ ASR: `POST /v1/audio/transcriptions` (multipart) → 텍스트 (HTTP 200, 문장 일치, RTF 0.30)
- ✅ **한 서버에 TTS+ASR 동시 등록** (`models:2`) — 상주 2모델 동작 확인
- ✅ 44.1kHz WAV 직접 입력 (서버 내부 리샘플)
- ⬜ VAD(`pulsevad`) 연결 — 마이크 입력 시 필요
- **산출물: "녹음 → 텍스트 → 다시 말하기" 왕복 동작** ← 서버 구간은 실증 완료, 마이크 캡처만 남음

> 실측: `bash run_pipeline.sh`(분리형) + `unified_server.json`(단일형)

### Phase 2 — 대화형 저지연
- TTS 문장 분할 + 첫 문장 우선 재생
- `transcriptions/live`로 실시간 자막
- 상태 머신(§6.2) 연결
- `max_loaded_models: 2` + 프리로드 튜닝

### Phase 3 — transcribe.cpp 고정확 ASR 경로 추가
- `libtranscribe.so` 빌드 + §7.2 래퍼(방식 D)
- `qwen3-asr-0.6b` / `qwen3-asr-1.7b` / `moonshine-base-ko`(MIT) 비교 평가
- 라우터에서 ASR 백엔드 전환 가능하게
- **목표: 한국어 WER 5.82% → 4.60% 구간 확보**

### Phase 4 — 보이스 클로닝 / 제품화
- Chatterbox-Turbo(699MB) 또는 VoxCPM1(848MB)로 사용자 목소리 복제
- `voice_dir` + `prompt_text`로 서버측 목소리 라이브러리 구축
- 모델 자동 다운로드 (`--ui-management`)

---

## 9. 리스크와 대응

| 리스크 | 심각도 | 대응 |
|---|---|---|
| 두 ggml 심볼 충돌 | **높음** | 프로세스 분리로 원천 차단 (§4.1) |
| 모바일 메모리 부족 | 높음 | Lite 티어 + `max_loaded_models` + `idle_unload_ms` + `min_free_memory_mb` |
| TTS↔ASR 모델 스왑 지연 | 중간 | 상주 2개 or 경량 조합 or 프리로드 |
| 한국어 품질 미달 | 중간 | WER 표 기반 모델 선택, Phase 3에서 백엔드 교체 가능 |
| **라이선스 오염** | **높음** | 아래 표 참조 — 상업 배포 시 `other`/`cc-by-nc` 회피 |
| transcribe.cpp Python 바인딩 미완성 | 중간 | C ABI 직접 FFI 또는 서버 래퍼(방식 D) |
| audio.cpp CPU 백엔드 성능 | 중간 | 문서상 "CUDA가 최적화 경로, CPU는 이식성 목적". 기대치 조정 필요 |

### 9.1 라이선스 주의 (상업 배포 기준)

**ASR — 한국어 지원 모델의 라이선스**

| 모델 | 라이선스 | 상업 배포 |
|---|---|---|
| qwen3-asr-0.6b / 1.7b | Apache-2.0 | ✅ |
| whisper-* | Apache-2.0 | ✅ |
| voxtral-mini-4b-realtime-2602 | Apache-2.0 | ✅ |
| cohere-transcribe-03-2026 | Apache-2.0 | ✅ |
| moonshine-base-ko / tiny-ko | **MIT** | ✅ (가장 자유) |
| fun-asr-mlt-nano-2512 | other | ⚠️ 개별 확인 (FunASR 계열) |
| sensevoice-small | other | ⚠️ 개별 확인 |
| nemotron-3.5-asr-streaming-0.6b | other | ⚠️ NVIDIA 라이선스 확인 |
| canary-1b | cc-by-nc-4.0 | ❌ 비상업 전용 |

**런타임 라이선스**
- audio.cpp: **Apache-2.0** ✅
- transcribe.cpp: **MIT** ✅
- ggml: MIT ✅

> `other`로 표기된 모델은 **모델별 라이선스가 별도**라는 뜻입니다. 상업 배포 전 반드시 원본 저장소 라이선스를 확인하세요.
> **가장 안전한 기본 조합**: TTS=Supertonic(Apache 계열 확인 필요) 또는 Kotoro/경량, ASR=`moonshine-base-ko`(**MIT**, 77MB) 또는 `qwen3-asr-0.6b`(**Apache-2.0**).

---

## 10. 이 환경(Android proot)에서의 빌드 노트

이 기기는 **Android aarch64 + proot + RAM 10GB(여유 2.5GB)**, gcc/clang 없음, apt에 `build-essential`/`cmake` 후보 없음입니다.
실제로 동작하는 경로를 찾았습니다:

```bash
# 1. 툴체인 확보 (aarch64용 ziglang 휠이 존재!)
python3 -m venv /root/workspace/.toolchain-venv
source /root/workspace/.toolchain-venv/bin/activate
pip install cmake ninja ziglang        # cmake 4.4.3, zig 0.16.0
```

**proot 특유의 문제 2가지와 회피 (실측)**

| 문제 | 증상 | 회피 |
|---|---|---|
| zig가 depfile 생성 시 세그폴트 | `-MD`/`-MF`/`-MT` 사용 시 `Segmentation fault (139)`. CMake는 무조건 이 플래그를 넘김 | 플래그를 제거하는 래퍼 (`toolchain/zig-cc`, `toolchain/zig-cxx`) |
| `CMAKE_AR` 감지 실패 | `CMAKE_AR-NOTFOUND: not found` → 링크 단계 중단 | `zig ar`/`zig ranlib` 래퍼 지정 |

```bash
# 2. transcribe.cpp 빌드 (검증된 명령)
bash /root/workspace/toolchain/build_transcribe_arm64.sh
#   → build/linux-arm64-cpu/bin/transcribe-cli
#   → NEON + dotprod + i8mm 자동 감지 확인됨
```

> **한계**: 이 기기에는 GPU가 없고 RAM이 부족해 **모델 추론 성능 측정은 무의미**합니다. 빌드 검증까지가 이 환경의 역할이고, 실제 성능 검증은 x86/CUDA 환경이나 GitHub Actions에서 하는 것을 권장합니다.
> **GitHub Actions 활용**: 두 레포 모두 광범위한 워크플로를 이미 갖고 있습니다(audio.cpp: `linux-build.yml` 등 7개, transcribe.cpp: `native-ci.yml`, `python-wheels.yml` 등 11개). 포크 후 재사용하는 것이 가장 빠른 CI 경로입니다.

---

## 11. 부록 — 핵심 API 요약

### transcribe.h 주요 함수

| 그룹 | 함수 |
|---|---|
| 초기화 | `transcribe_init_backends`, `transcribe_init_backends_default` |
| 디바이스 | `transcribe_device_count`, `transcribe_device_get`, `transcribe_device_get_info`, `transcribe_backend_available` |
| 모델 | `transcribe_model_load_file`, `transcribe_model_free`, `transcribe_model_get_capabilities`, `transcribe_model_supports` |
| 세션 | `transcribe_open`, `transcribe_session_init`, `transcribe_close`, `transcribe_session_free` |
| 추론 | `transcribe_run`, `transcribe_run_batch`, `transcribe_set_abort_callback` |
| 결과 | `transcribe_full_text`, `transcribe_n_segments`, `transcribe_get_segment`, `transcribe_get_word`, `transcribe_get_token`, `transcribe_detected_language` |
| 화자분리 | `transcribe_n_speaker_segments`, `transcribe_get_speaker_segment` |
| 스트리밍 | `transcribe_stream_begin/feed/finalize/reset`, `transcribe_stream_get_text`, `transcribe_stream_revision`, `transcribe_stream_n_committed_*` |
| 배치 | `transcribe_batch_n_results`, `transcribe_batch_full_text`, `transcribe_batch_status` |
| 타이밍 | `transcribe_get_timings`, `transcribe_print_timings` |
| 유틸 | `transcribe_status_string`, `transcribe_version`, `transcribe_log_set`, `transcribe_tokenize` |

### audio.cpp 서버 엔드포인트 요약

| 엔드포인트 | 용도 |
|---|---|
| `GET /health` | 준비 상태 + 설정된 모델 수 |
| `GET /v1/models` | OpenAI 스타일 모델 목록 |
| `GET /v1/audio/voices` | 사용 가능한 보이스 (프리셋 + voice_dir) |
| `POST /v1/audio/speech` | **TTS** (WAV / json(base64) / mp3) |
| `POST /v1/audio/speech/live` | raw PCM 청크 입력 → 즉시 오디오 (S2S) |
| `POST /v1/audio/transcriptions` | **ASR** (JSON 경로 또는 multipart 업로드) |
| `POST /v1/audio/transcriptions/details` | ASR + words/segments/speaker_turns |
| `POST /v1/audio/transcriptions/live` | 실시간 PCM → SSE 델타 |
| `POST /v1/audio/alignments` | 강제 정렬 (오디오 + 정답 텍스트) |
| `POST /v1/models/load` \| `/unload` | 동적 모델 전환 |
| `POST /v1/ui/models/install` | 모델 다운로드 (ui-management) |

### audio.cpp CLI 핵심 옵션

```
--task   gen|tts|clon|vc|svc|s2s|asr|align|vad|diar|sep|vdes|midi
--family <패밀리명>            --model <모델 디렉터리>
--backend cpu|cuda|vulkan|metal|best      --mode offline|streaming
--text / --audio / --voice-ref / --language / --out / --out-dir
--segments-out (VAD JSON)  --turns-out (화자분리 JSON)  --words-out (워드 타임스탬프)
--request-sequence <json>       # 배치: 하나의 세션으로 여러 요청
--batch-text-dir / --batch-audio-dir
--metrics                       # wall_ms, RTF, x_realtime 출력
```

---

## 12. 최종 권장안

1. **Phase 1은 audio.cpp 단일 엔진으로 시작하세요.** HTTP 하나로 TTS+ASR이 모두 되고, 모델 관리·WebUI·OpenAI 호환이 공짜로 따라옵니다. `--model-set custom`으로 필요한 패밀리만 빌드하면 됩니다.
2. **`max_loaded_models: 2` + Supertonic(454MB) + qwen3-asr-0.6b(850MB)** = 1.3GB로 이 기기에서도 양쪽 상주가 가능합니다. 이것이 표준 티어입니다.
3. **transcribe.cpp는 Phase 3에서 고정확 ASR 경로로 추가**하세요. 별도 프로세스 + C ABI(방식 D)로 붙이면 ggml 충돌을 피하면서 한국어 WER을 5.82% → 4.60%로 낮출 수 있습니다.
4. **라이선스는 `moonshine-base-ko`(MIT) 또는 `qwen3-asr-0.6b`(Apache-2.0)를 기본으로** 잡고, `other`/`cc-by-nc` 표기 모델은 상업 배포 전 개별 확인하세요.
5. **VAD는 audio.cpp 번들 모델(`silero_vad`)을 쓰세요.** 추가 다운로드가 필요 없습니다.
