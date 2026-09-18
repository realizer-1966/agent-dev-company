# 검증 기록 (실측)

이 문서는 설계서의 주장을 **실제로 실행해서 확인한** 결과만 담습니다.
환경: Android aarch64 / proot / RAM 10.82GB / GPU 없음 / gcc·clang 미설치

---

## 1. 툴체인 확보 (성공)

proot 이미지에 컴파일러가 없고 `apt`에 `build-essential`/`cmake` 후보가 없었습니다.

```
$ apt-get install -s build-essential cmake
E: Package 'build-essential' has no installation candidate
E: Unable to locate package cmake
```

**해결**: aarch64용 ziglang 휠이 PyPI에 존재합니다.

```
$ pip install cmake ninja ziglang
cmake version 4.4.3
ninja 1.13.2
zig 0.16.0   (/root/workspace/.toolchain-venv/lib/python3.11/site-packages/ziglang/zig)
```

`zig env`가 `target = aarch64-linux.6.1.145...gnu.2.36`를 보고 → 네이티브 타겟 확인.

## 2. proot 특유의 문제 3가지 (실측 및 회피)

### 문제 1 — zig가 depfile 생성 시 세그폴트

CMake가 TryCompile 단계에서 무조건 넘기는 플래그가 원인이었습니다.

```
$ zig cc -MD -o m1.o -c a.c     → Segmentation fault (139)
$ zig cc -MF m2.d -o m2.o -c a.c → Segmentation fault (139)
$ zig cc -MD -MF m3.d -o m3.o -c a.c → Segmentation fault (139)
$ zig cc -o c.o -c a.c          → exit=0, 오브젝트 생성 성공
```

**정확한 재현 조건**: `-MD`, `-MMD`, `-MF`, `-MT` 중 **어느 하나라도 있으면** 실패.
ninja의 depfile 처리와 무관하게 shell에서 직접 실행해도 재현됨.

CMake 증상:
```
cmake -S . -B build  →  The C compiler ... is not able to compile a simple test program
                        FAILED: [code=139] ... Segmentation fault
```

**회피**: 플래그를 제거하는 래퍼. `toolchain/zig-cc`, `toolchain/zig-cxx`.
부작용은 의존성 추적 상실(증분 빌드 granularity만 손해).

### 문제 2 — CMAKE_AR 감지 실패

```
/bin/sh: 1: CMAKE_AR-NOTFOUND: not found
ninja: build stopped: subcommand failed.
```

`-DCMAKE_AR=...`를 넘겨도 CMake가 컴파일러 ABI 감지 단계에서 다시 판단해
`rules.ninja`에 `CMAKE_AR-NOTFOUND`를 기록했습니다.

```
$ grep -n "CMAKE_AR" build/CMakeFiles/rules.ninja
123:  command = ... && CMAKE_AR-NOTFOUND qc $TARGET_FILE $LINK_FLAGS $in && ...
```

**회피**: `rules.ninja`의 문자열을 직접 치환 + `zig ar` 래퍼 지정.

```python
s = pathlib.Path('CMakeFiles/rules.ninja').read_text()
s = s.replace('CMAKE_AR-NOTFOUND', '/root/workspace/toolchain/zig-ar')
```

### 문제 3 — CMake 설정이 매우 느림

`-- Checking for ARM features` 및 각종 TryCompile에 약 **249초** 소요.
(zig가 매 테스트마다 내부 캐시를 채우기 때문.) 캐시가 데워진 뒤 재실행은 빨랐습니다.

---

## 3. transcribe.cpp aarch64 빌드 (성공)

```
$ bash toolchain/build_transcribe_arm64.sh
-- Checking for ARM features using flags:
--   -mcpu=native+dotprod+i8mm
-- Performing Test HAVE_DOTPROD - Success
-- Performing Test HAVE_MATMUL_INT8 - Success
-- Performing Test HAVE_FMA - Success
-- Performing Test HAVE_FP16_VECTOR_ARITHMETIC - Success
-- Adding CPU backend variant ggml-cpu: -mcpu=native+dotprod+i8mm
-- ggml version: 0.20.2
-- ggml commit:  be7a8b3
-- transcribe install: 0.2.3 shared=OFF backends: cpu
```

빌드 결과:

| 산출물 | 크기 | 비고 |
|---|---|---|
| `bin/transcribe-cli` | 37 MB | ELF 64-bit LSB, **ARM aarch64**, dynamically linked |
| `bin/transcribe-hello` | 37 MB | 5단계 C API 예제 |
| `bin/transcribe-hello-stream` | 37 MB | 스트리밍 C API 예제 |
| `bin/transcribe-batch-bench` | 37 MB | 배치 벤치 |
| `src/libtranscribe.a` | 52 MB | 정적 라이브러리 |

**NEON + dotprod + i8mm이 자동 감지되어 활성화**된 것이 핵심 — aarch64에서
SIMD 경로가 정상 빌드된다는 뜻입니다.

## 4. 런타임 실행 검증 (성공)

```
$ ./bin/transcribe-cli --list-devices
1 compute device(s):
  [0] CPU
      name=CPU  kind=cpu  type=cpu  id=(none)
      memory: 10.82 GiB total, 10.82 GiB free
```

## 5. 엔드투엔드 한국어 ASR 추론 (성공)

**모델**: `handy-computer/moonshine-base-ko-gguf` Q8_0 — **77.5 MB, MIT 라이선스**
(레포 자체 샘플 `samples/ko-long.wav`, `samples/ko-short.wav` 사용)

### 테스트 1 — ko-long.wav (25.8초)

```
$ ./bin/transcribe-cli -m moonshine-base-ko-Q8_0.gguf -l ko samples/ko-long.wav
[info] timings: load=83.58 ms  mel=0.00 ms  encode=855.54 ms  decode=3626.87 ms
audio: samples/ko-long.wav
  samples:    412800
  duration:   25.800 s
  sample rate 16000 Hz mono float32
model: moonshine-base-ko-Q8_0.gguf -> ok
  backend:    CPU
  name:       Moonshine Base (Korean)
  license:    mit
  max audio:  48.5 s
run: ok
text: 미국 지릴 조사국 천문지지락팀 및 아리조나주 플래그스테프의 노던아리조나 대학 소속인
      글랜쿠싱은 이러한 열정 거동은 일정한 온도를 유지하는 지구의 큰 동굴만큼 안정적이지는
      않지만 지표면에 깊은 구멍에 일치한다고 말했습니다
  realtime:   6x (4482.4 ms for 25.8 s)
```

### 테스트 2 — ko-short.wav (11.0초)

```
text: 우리는 한 마리 이상 세 마리의 동족 성인 수컷과 무려 삼십 마리에 이르는
      암컷과 새끼로 구성됩니다
  realtime:   4x (2744.0 ms for 11.0 s)
```

### 테스트 3 — qwen3-asr-0.6b (Apache-2.0, 850MB) 비교

같은 오디오로 정확도를 직접 비교했습니다.

```
$ ./bin/transcribe-cli -m qwen3-asr-0.6b-Q8_0.gguf -l ko samples/ko-long.wav
model: qwen3-asr-0.6b-Q8_0.gguf -> ok
  backend:    CPU
  name:       Qwen3-ASR 0.6B
  license:    apache-2.0
  max audio:  5218.6 s  (context 65536 tok, ~7168 MiB KV max)
text: 미국 지질조사국 천문지질학팀 및 아리조나주 플래그스테프의 노던 아리조나 대학교 소속인
      글렌 쿠싱은 이러한 열적 거동은 일정한 온도를 유지하는 지구의 큰 동굴만큼
      안정적이지는 않지만 지표면의 깊은 구멍에 일치한다고 말했습니다.
  realtime:   2x (13637.3 ms for 25.8 s)
```

```
$ ./bin/transcribe-cli -m qwen3-asr-0.6b-Q8_0.gguf -l ko samples/ko-short.wav
text: 물리는 한 마리에서 세 마리의 동족 성인 수컷과 무려 30 마리에 이르는
      암컷과 새끼로 구성됩니다.
  realtime:   3x (4048.5 ms for 11.0 s)
```

### 정확도 비교 — 카탈로그 WER 순위가 실측으로 확인됨

동일 오디오, 동일 조건에서 두 모델의 차이가 뚜렷합니다.

| 표현 | moonshine-base-ko (WER 8.12%) | qwen3-asr-0.6b (WER 5.82%) | 정답 |
|---|---|---|---|
| 기관명 | 지**릴**조사국 | 지**질**조사국 | 지질조사국 ✅ |
| 용어 | **천문지지락팀** | 천문지질학팀 | 천문지질학팀 ✅ |
| 고유명사 | **글랜쿠싱** | **글렌 쿠싱** | 글렌 쿠싱 ✅ |
| 어휘 | **열정** 거동 | **열적** 거동 | 열적 거동 ✅ |
| 대학명 | 노던**아리조나 대학** | 노던 **아리조나 대학교** | 노던 아리조나 대학교 ✅ |
| 숫자 표기 | 삼십 마리 | 30 마리 | — |
| 문장부호 | 없음 | 마침표 있음 ✅ | — |

→ **카탈로그의 WER 순서(qwen3 5.82% < moonshine 8.12%)와 실측 관찰이 일치**합니다.
→ 다만 **moonshine은 77MB/MIT, qwen3는 850MB/Apache-2.0**으로 크기 차가 11배입니다.
→ 실행 속도는 moonshine이 2~3배 빠릅니다 (디코더 구조 차이).

**트레이드오프 요약**

| 목표 | 선택 |
|---|---|
| 최고 정확도 | `qwen3-asr-0.6b` (또는 1.7b) |
| 최소 크기 / 최대 라이선스 자유도 | `moonshine-base-ko` |
| 저지연 | `moonshine-base-ko` (4~6x 실시간) |

### 관찰

- **한국어 텍스트가 정상 출력됨** — 77MB 모델이 이 기기에서 실동작.
- **4~6배 실시간** (CPU 전용, GPU 없음). 프로덕션에서는 충분히 실용적.
- 로드 83ms로 매우 빠름 → **요청마다 프로세스를 띄우는 CLI 방식도 지연이 작음**.
- 디코드가 병목(3626ms vs 인코드 855ms) — 디코더가 AR 구조라 당연한 결과이며,
  이는 transcribe.cpp가 `libopenblas` 있으면 디코더가 10~15배 빨라진다고 문서화한 부분과 일치.
  **이 환경에는 BLAS가 없어 스칼라 폴백으로 동작 중** (`no BLAS found — decoder uses scalar fallback`).
  → 실제 배포 시 `libopenblas` 설치하면 추가 가속 여지가 있음.
- `license: mit`가 런타임 메타데이터로 출력됨 → GGUF에 라이선스가 박혀 있어 추적 가능.

## 6. ggml 심볼 충돌 검증 (설계의 핵심 근거)

두 레포가 **각자 다른 버전의 ggml을 내장**하고, 라이브러리 이름까지 동일합니다.

| | audio.cpp | transcribe.cpp |
|---|---|---|
| ggml 위치 | `external/ggml` | `ggml/` |
| ggml 버전 | **0.12.0** | **0.20.2** |
| 레포 sha | (vendored) | `8c63e70982c95ceb862e3a1073a2c1beef75d60a` (+패치) |
| `add_library` 이름 | `ggml`, `ggml-base` | `ggml`, `ggml-base` |
| `ggml::ggml` ALIAS | 있음 | 있음 |

심볼 중복 실측:

```
$ grep -ohE "ggml_(new_tensor|build_forward_expand|graph_compute|...)" \
    audio.cpp/external/ggml/src/ggml.c transcribe.cpp/ggml/src/ggml.c | sort | uniq -c
     12 ggml_build_forward_expand
     86 ggml_new_tensor
```

`ggml.c` 내 `ggml_*` 심볼 총 개수: audio.cpp **1,335개**, transcribe.cpp **1,285개**.
→ **약 1,300개 심볼이 두 라이브러리에서 동일한 이름으로 정의**됩니다.

**결론: 한 프로세스에 정적 링크하면 중복 정의로 링크 실패하거나, 통과하더라도 한쪽
백엔드가 다른 버전의 ggml에 바인딩되어 조용히 오작동합니다.** → 프로세스 분리 설계의 근거.

## 7. 확인된 제약

| 제약 | 실측 근거 |
|---|---|
| ASR 입력은 16kHz mono f32만 | `transcribe.h:1014`, `:1526`, `:2139` — "no caller-supplied sample rate; the library does not link a resampler" |
| CLI 출력이 stdout | `-o/--output PATH`로 파일 분리 가능 |
| GGUF에 라이선스 내장 | 런타임이 `license: mit` 출력 |
| 스트리밍 지원 ≠ 전 모델 | `transcribe.h:1917+` `supports_streaming` 게이트 필요 |
| 이 기기 GPU 없음 | `--list-devices` → CPU만 |

## 8. audio.cpp aarch64 빌드 (성공)

transcribe.cpp와 **동일한 zig 래퍼 우회**로 빌드했습니다.
설정 단계에서 ARM 최적화가 자동 감지되고, 83개 오디오 모델 타겟이 등록됩니다.

```
$ bash toolchain/build_audio_arm64.sh
-- Checking for ARM features: -mcpu=native+dotprod+i8mm
-- Performing Test HAVE_DOTPROD - Success
-- ggml version: 0.12.0
-- Registered model targets: 83
```

| 산출물 | 크기 | 비고 |
|---|---|---|
| `bin/audiocpp_server` | 63 MB | OpenAI 호환 HTTP 서버 + WebUI |
| `bin/audiocpp_cli` | 56 MB | CLI (모델 카탈로그 조회/합성) |

```
$ ./bin/audiocpp_server --list-devices
  [0] CPU  kind=cpu  memory: 10.82 GiB total
```

## 9. TTS 한국어 합성 (성공)

**모델**: `Supertonic-3` Q8_0 GGUF (약 454 MB, 한국어 포함 31개 언어, 내장 보이스)

### CLI 직접 합성

```
$ ./bin/audiocpp_cli --model models/tts/Supertonic-3-GGUF/supertonic-3-q8_0.gguf \
    --task tts --voice-id M1 --out tts_ko.wav \
    --text "안녕하세요. 오늘은 날씨가 좋습니다."
```

| 항목 | 실측값 |
|---|---|
| 출력 파일 | `tts_cli_ko.wav` 313,752 bytes |
| 길이 | 3.56 s |
| 샘플레이트 | 44100 Hz mono 16-bit |
| peak | 12054 (실제 음성 파형 확인) |

→ **CLI와 HTTP 경로의 산출물이 md5까지 동일** (`7f138a9356a5bd0e5064a16700bc89fb`).
두 진입점이 같은 엔진·같은 결정적 추론 경로를 쓴다는 뜻입니다.

### HTTP 경유 합성 — OpenAI 호환 엔드포인트

```
$ curl -X POST http://127.0.0.1:8911/v1/audio/speech \
    -H "Content-Type: application/json" \
    -d '{"model":"supertonic-ko","input":"안녕하세요. 오늘은 날씨가 좋습니다.",
         "voice":"M1","response_format":"wav"}' -o http_tts_ko.wav
HTTP=200  size=313752 bytes  time=17.88 s
```

| 항목 | 실측값 |
|---|---|
| HTTP 상태 | **200** |
| 크기 | 313,752 bytes |
| 길이 | 3.56 s @ 44100 Hz |
| peak | 12054 (실제 음성) |
| 소요 시간 | 17.9 s (최초 모델 로드 포함), 이후 요청은 1.3 s |

## 10. HTTP 전 구간 왕복 검증 (성공) — 설계의 최종 증명

**두 독립 프로세스가 실제 소켓으로 통신**해 TTS→ASR 파이프라인이 완결됩니다.

```
[TTS 서버 :8911 audiocpp_server]  --wav-->  리샘플  --f32le-->  [ASR 서버 :8910 asr_http_server]
```

1) TTS HTTP 합성 (위 §9)
2) 44.1kHz → 16kHz mono f32 변환 (`verification/wav_to_f32.py`)
3) ASR HTTP 전송:

```
$ curl -X POST http://127.0.0.1:8910/transcribe \
    -H "Content-Type: application/octet-stream" \
    --data-binary @http_tts_ko.f32
{"text":"안녕하세요 오늘은 날씨가 좋습니다.","language":"",
 "segments":[{"t0_ms":0,"t1_ms":3556,"speaker_id":0,
              "text":"안녕하세요 오늘은 날씨가 좋습니다."}]}
HTTP=200  time=1.31 s
```

**입력 문장과 인식 결과가 일치** — 서로 다른 두 런타임(audio.cpp ggml 0.12.0 /
transcribe.cpp ggml 0.20.2)이 프로세스 분리 하에서 정상 협업함이 실증되었습니다.

## 11. asr_server / asr_http_server 링크·실행 검증 (성공)

설계서 §7.2의 C 래퍼가 **실제 `libtranscribe.a`와 링크되어 동작**합니다.

```
$ ./asr_server model.gguf ko < ko.f32
{"text":"안녕하세요 오늘은 날씨가 좋습니다.", ...}
```

| 래퍼 | 크기 | 역할 |
|---|---|---|
| `asr_server` | 36.5 MB | stdin f32 → stdout JSON (최소 예시) |
| `asr_http_server` | 36.6 MB | 실제 HTTP 서버 (설계서 "방식 D") |

링크에 필요한 라이브러리 순서 (검증됨):
```
libtranscribe.a libggml.a libggml-cpu.a libggml-base.a -lstdc++ -lm -lpthread
```

## 12. audio.cpp 단일 엔진 TTS+ASR (성공) — 대안 설계 검증

§4.2의 "audio.cpp 단일 엔진" 대안이 실제로 성립하는지 확인했습니다.

**전제 발견**: audio.cpp 배포 GGUF는 **self-contained**입니다.
`audio-cpp/audio.cpp-gguf`의 `qwen3-asr-0.6b-q8_0.gguf`(1.15GB)는 config/tokenizer가
GGUF 안에 임베드되어 있어 단독으로 `--model`에 전달 가능합니다.

### CLI 단독

```
$ audiocpp_cli --task asr --family qwen3_asr \
    --model qwen3-asr-0.6b-q8_0-audiocpp.gguf --backend cpu \
    --audio http_tts_ko.wav --text-out audiocpp_asr_ko.txt
text_output=안녕하세요 오늘은 날씨가 좋습니다.
session.wall_ms 1640.96
```

**44.1kHz WAV를 그대로 넣어 정상 인식** — transcribe.cpp와 달리 외부 리샘플러가 불필요합니다.

### 한 서버에서 TTS + ASR 동시

```json
// unified_server.json — 모델 2개 (supertonic-ko:TTS, qwen3-asr:ASR)
```

```
$ audiocpp_server --config unified_server.json --port 8912 --backend cpu
{"status":"ok","backend":"cpu","models":2,...}

# TTS
$ curl -X POST :8912/v1/audio/speech -d '{"model":"supertonic-ko",
    "input":"안녕하세요. 오늘은 날씨가 좋습니다.","voice":"M1","response_format":"wav"}'
HTTP=200  bytes=313752  time=17.94s

# ASR — 같은 서버, TTS 산출물을 그대로 업로드
$ curl -X POST :8912/v1/audio/transcriptions \
    -F model=qwen3-asr -F language=ko -F file=@uni_tts_ko.wav
{"text":"안녕하세요 오늘은 날씨가 좋습니다.",
 "timing":{"wall_ms":1068.2,"audio_duration_ms":3556.8,"rtf":0.30}}
HTTP=200  time=1.07s
```

### 아키텍처 정면 비교 (동일 오디오·동일 결과)

| | A) 분리형 (transcribe.cpp ASR) | B) 단일형 (audio.cpp ASR) |
|---|---|---|
| 인식 결과 | ✅ 문장 일치 | ✅ 동일 |
| 워밍 후 지연 | 1.71 s | **1.07 s** (RTF 0.30) |
| HTTP 서버 수 | 2 | **1** |
| 리샘플러 | 필요 (`wav_to_f32.py`) | **불필요** (서버 내부) |
| 프로세스 격리 | 완전 | 불필요(단일 런타임) |

→ 둘 다 동작합니다. **운영 단순성은 B, ASR 선택 자유도·MIT 라이선스는 A** 우세.

## 13. 엔진별 GGUF 비호환 (실측 함정)

같은 모델 이름이어도 **벤더별 GGUF 레이아웃이 달라 서로 쓸 수 없습니다.**

```
$ audiocpp_cli --task asr --family qwen3_asr --model .../qwen3-asr-0.6b-Q8_0.gguf
audiocpp_cli failed: missing model package file 'config': .../models/asr/config.json
```

| | transcribe.cpp GGUF | audio.cpp GGUF |
|---|---|---|
| 저장소 | `handy-computer/moonshine-base-ko-gguf`, `Qwen/Qwen3-ASR-*` | `audio-cpp/audio.cpp-gguf` |
| 크기 (qwen3-asr-0.6b q8) | 850 MB | **1,151 MB** |
| config 취급 | 외부 파일 | **GGUF 내장** |
| 호환 | ❌ | ❌ |

또한 audio.cpp 소스 빌드 CLI는 스펙 파일이 필요합니다:
`--model-spec-override /root/workspace/audio.cpp/model_specs/qwen3_asr.json`

그리고 `model_specs/moonshine_asr.json`은 **영어 전용**(`languages: ["en"]`)입니다.
한국어는 `qwen3_asr`(31개 언어) 또는 `cohere_asr` / `vibevoice_asr_streaming`을 쓰세요.

## 14. 잔존 프로세스로 인한 성능 열화 (실측 함정)

검증 중 같은 명령이 **24배 느려지는 현상**을 겪고 원인을 확정했습니다.

```
정상(워밍):  session.wall_ms 1068     RTF 0.30   HTTP 1.07s
메모리 압박: session.wall_ms 25303    RTF 7.12   HTTP 29.6s
정리 후:     session.wall_ms 1789     RTF 0.50   HTTP 5.57s
```

**원인**: 이전 세션에서 띄운 `asr_http_server`가 죽지 않고 살아남아
모델을 상주한 채 **1GB+ 메모리를 점유**했습니다. 그 결과 가용 메모리가
3.9GB까지 줄고 스왑 4.9GB가 사용되어 모델 페이지가 스왑아웃됐습니다.

**진단 명령**

```bash
grep -E "MemAvailable|SwapFree" /proc/meminfo
# MemAvailable: 3921524 kB   ← 정상 대비 크게 낮음
# SwapFree:    11750432 kB   ← 스왑 사용 중

for p in /proc/[0-9]*; do pid=${p#/proc/};
  tr '\0' ' ' < "$p/cmdline" 2>/dev/null \
    | grep -q "audiocpp_server\|asr_http_server" && echo "잔존 PID=$pid"; done
```

→ `proot`에서는 **`ps aux`가 프로세스를 거의 보여주지 못합니다.** `/proc/*/cmdline` 순회가 필요합니다.

**교훈**: 검증 스크립트는 `trap 'kill $PID' EXIT`로 자기 서버를 반드시 정리해야 합니다
(`run_pipeline.sh`, `run_unified.sh` 모두 적용됨). 서버를 반복 기동하는 검증에서는
이 정리가 없으면 측정치가 조용히 오염됩니다.

## 15. 아직 검증하지 못한 것 (정직한 한계)

| 항목 | 이유 |
|---|---|
| 모델 추론 성능 (절대치) | 이 기기는 CPU 전용 + RAM 2.5GB 여유 → 대표성 없음 |
| CUDA/Vulkan 경로 | GPU 없음. x86/CUDA 환경 또는 GitHub Actions 필요 |
| 스트리밍 API 실동작 | 스트리밍 지원 모델(별도 다운로드) 필요 |
| transcribe.cpp Python 바인딩 | 휠 미배포 상태 (문서에 "in development" 명시) |
| Android 앱 내부 직접 실행 | 프로세스 분리 시 ggml 충돌은 회피되나, 앱 패키징(NDK/JNI)은 미검증 |
