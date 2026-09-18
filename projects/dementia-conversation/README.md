# 치매 대화 (dementia-conversation) — 한국어 TTS/ASR 파이프라인

> **목표**: 치매 환자와의 대화를 돕는 온디바이스 한국어 음성 파이프라인.
> 환자가 말하면(ASR) → 시스템이 이해·응답하고 → 자연스러운 한국어 음성으로 되돌려준다(TTS).
> 모든 추론이 기기 안에서 끝나야 한다 — 개인 의료·대화 데이터를 외부로 보내지 않는다.

두 개의 ggml 기반 오디오 추론 런타임(audio.cpp + transcribe.cpp)을
Android aarch64 / proot 기기에서 **실제로 빌드하고 한국어 TTS→ASR 왕복까지 검증**한 결과물입니다.

> **모든 수치는 이 저장소의 스크립트로 재현 가능합니다.** 가정이나 문서 인용이 아닙니다.

## 구성

| 경로 | 무엇 |
|---|---|
| `web/` | **WebUI** — 환자용 음성 대화 화면 (PWA, 단독 배포 가능) |
| `Android/` | **APK** — WebView 로 WebUI 를 감싼 안드로이드 앱 ("마음이") |
| `*.md`, `run_*.sh`, `toolchain/` | 엔진 빌드·검증 자료 (아래 "검증된 결과") |

## APK 받기 (마음이)

1. **Actions → Build Dementia Conversation APK → 최신 성공 실행 → Artifacts → `dementia-conversation-apk`**
   https://github.com/realizer-1966/agent-dev-company/actions/workflows/build-dementia-conversation-apk.yml
2. 내려받은 zip 을 풀면 `app-release.apk` (약 1.7MB). 폰에 설치 (v2/v3 서명됨).
3. 앱 실행 → **⚙️ 설정** → 서버 주소 입력 (예: `http://192.168.0.10:8912`) → **저장하고 연결 확인**
4. **💬 대화** 탭 → 큰 **말하기** 버튼 → 말씀 → 자동으로 인식·응답·재생

> 서버가 없으면 화면만 뜨고 음성은 동작하지 않습니다. 로컬 서버 띄우는 법은
> 아래 `run_unified.sh` (단일형) 또는 `run_pipeline.sh` (분리형) 를 참고하세요.

### 앱 사용 흐름

```
[말하기 버튼] → 녹음 → 16kHz WAV 변환 → POST /v1/audio/transcriptions
   → 인식 텍스트를 말풍선에 표시 → 규칙 기반 응답 생성 (기기 내)
   → POST /v1/audio/speech → 자동 재생
```

- **외부 전송 없음**: WebUI 는 외부 도메인을 전혀 호출하지 않고, 응답 생성은
  기기 내 규칙 테이블입니다. 대화 내용이 밖으로 나가지 않습니다.
- **접근성**: 글자 크기 3단계(보통/크게/아주 크게), 최소 터치 높이 76px,
  고대비 색상, 단순한 3탭 구조.
- **자주 쓰는 문장** 5개를 원터치로 재생 (말하기 탭).

## 왜 이 두 엔진인가

| 요구 | 근거 |
|---|---|
| 온디바이스 (프라이버시) | 두 엔진 모두 로컬 CPU 추론. 외부 API 호출 없음 |
| 한국어 지원 | TTS `Supertonic-3`(31개 언어), ASR `qwen3_asr` / `moonshine-base-ko` |
| 저지연 대화 | 단일형 RTF 0.30 (3.5초 발화를 1.07초에 인식) |
| 라이선스 | moonshine-base-ko = **MIT** (상업 배포 가능), Supertonic = 오픈 |

## 무엇이 들어있나

| 파일 | 내용 |
|---|---|
| **`DESIGN.md`** | 설계서 (887줄) — 두 레포 분석, 아키텍처 A/B안, 모델 전략, 로드맵, 함정 |
| **`VERIFICATION.md`** | 실측 기록 (15섹션) — 빌드 로그, 추론 결과, 실패와 우회 |
| `run_pipeline.sh` | **분리형** 원샷 검증 (TTS 서버 + ASR 서버 2개) |
| `run_unified.sh` | **단일형** 원샷 검증 (서버 1개에서 TTS+ASR) |
| `asr_server.c` | transcribe.cpp C API 최소 래퍼 (stdin f32 → stdout JSON) |
| `asr_http_server.c` | transcribe.cpp C API HTTP 서버 래퍼 |
| `tts_server.json` / `unified_server.json` | 서버 모델 설정 |
| `toolchain/` | proot 빌드용 zig 래퍼 4종 + 빌드 스크립트 2종 |
| `verification/wav_to_f32.py` | 44.1kHz WAV → 16kHz mono f32 (순수 stdlib) |

## 관련 프로젝트

- `projects/audio-pwa` — 이 파이프라인을 브라우저 UI로 노출한 PWA
- `projects/transcribe-server` — ASR 서버 운영 스크립트

## 검증된 결과 요약

```
두 레포 aarch64 빌드      ✅ transcribe-cli 37MB / audiocpp_server 63MB
한국어 ASR (transcribe)   ✅ moonshine(MIT 77MB) vs qwen3-asr(850MB) 비교
한국어 TTS (audio.cpp)    ✅ Supertonic-3, CLI·HTTP 산출물 md5 동일
A) 분리형 왕복            ✅ 서버 2개, 소켓 통신, 1.71s
B) 단일형 왕복            ✅ 서버 1개, TTS+ASR 동시, 1.07s (RTF 0.30)
ggml 심볼 충돌            ✅ 약 1,300개 중복 실측
```

## 재현 방법

### 0. 툴체인 (컴파일러가 없는 기기)

```bash
python3 -m venv /root/workspace/.toolchain-venv
source /root/workspace/.toolchain-venv/bin/activate
pip install cmake ninja ziglang
```

aarch64용 `ziglang` 휠이 PyPI에 있어 네이티브 빌드가 가능합니다.

### 1. 빌드

```bash
# proot에서 `zig cc -MD/-MF` 가 세그폴트하므로 래퍼를 씁니다 (toolchain/zig-cc)
bash toolchain/build_transcribe_arm64.sh   # → transcribe.cpp/build/linux-arm64-cpu
bash toolchain/build_audiocpp_arm64.sh     # → audio.cpp/build/linux-arm64-cpu
```

설정 단계가 약 249초 걸리는 것은 정상입니다 (zig 내부 캐시 워밍).

### 2. 모델

```bash
# transcribe.cpp용 (자체 레이아웃)
curl -L -o moonshine-base-ko-Q8_0.gguf \
  "https://huggingface.co/handy-computer/moonshine-base-ko-gguf/resolve/main/moonshine-base-ko-Q8_0.gguf"

# audio.cpp용 (config 임베드 — self-contained)
curl -L -o qwen3-asr-0.6b-q8_0-audiocpp.gguf \
  "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/Qwen3-ASR-0.6B-GGUF/qwen3-asr-0.6b-q8_0.gguf"

# TTS (Supertonic-3, 한국어 포함 31개 언어)
# → audio-cpp/audio.cpp-gguf 리포의 Supertonic-3-GGUF/
```

### 3. 검증

```bash
bash run_pipeline.sh    # A안: 분리형
bash run_unified.sh     # B안: 단일형
```

## 핵심 결론

**두 라이브러리를 한 프로세스에 링크하면 안 됩니다.** 둘 다 `add_library(ggml ...)`로
같은 이름의 정적 라이브러리를 만들고 `ggml_*` 심볼 약 1,300개가 중복됩니다
(버전도 0.12.0 vs 0.20.2). 링크 실패하거나 — 더 위험하게 — 한쪽이 다른 버전에
바인딩되어 **조용히 오작동**합니다.

| | A) 분리형 | B) 단일형 |
|---|---|---|
| 서버 수 | 2 | **1** |
| 리샘플러 | 필요 | **불필요** (서버 내부) |
| 워밍 후 지연 | 1.71 s | **1.07 s** |
| ASR 선택 자유도 | 높음 (MIT 포함) | audio.cpp 카탈로그 한정 |
| 한국어 ASR 모델 | moonshine(MIT 77MB) / qwen3 | qwen3_asr / cohere / vibevoice |

→ **권장 순서: MVP는 단일 엔진(B) → 고정확 ASR이 필요해지면 분리형(A) 추가.**

## 함정 (실측)

| 함정 | 증상 / 대응 |
|---|---|
| 엔진별 GGUF 비호환 | `missing model package file 'config'` → 벤더별 GGUF를 따로 받기 |
| audio.cpp CLI 스펙 필요 | `model spec not found` → `--model-spec-override model_specs/<family>.json` |
| audio.cpp moonshine은 영어 전용 | `languages:["en"]` → 한국어는 `qwen3_asr` 사용 |
| transcribe.cpp 입력 | 16kHz mono f32 강제 (리샘플러 미링크) |
| proot `pkill` | 셸 자신을 죽임 → 트랩/`process kill` 사용 |

## 미검증 항목 (정직한 한계)

VAD(`pulsevad`) 연결, 스트리밍 API 실동작, Android 앱 패키징(NDK/JNI),
CUDA/Vulkan 경로(GPU 없음), 절대 성능치(이 기기 CPU 전용·RAM 여유 2.5GB).
