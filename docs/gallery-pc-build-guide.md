# Gallery APK PC 빌드 가이드 (기기 네이티브 설치용)

> 이 문서는 이 proot/Android 환경에서는 빌드가 불가능(Java/Gradle/RAM 부족)하므로,
> **PC(Mac/Windows/Linux)에서 `realizer-1966/gallery`를 빌드해 APK를 만든 뒤
> 폰에 설치**하는 절차를 정리한 것입니다.

빌드 대상: **gallery 포크** (LiteRT-LM 내장 + Voice Chat + 스킬 + MCP 탑재)
- `applicationId`: `com.google.aiedge.gallery`
- `versionName`: 1.0.18 / `versionCode`: 40
- `minSdk`: 31 (Android 12+) / `targetSdk`: 37
- 주요 의존성: `litertlm 0.11.0`, `webrtc 144.7559.09`, `vosk 0.3.47`, Hilt, Compose

---

## 1. 사전 준비 (PC)

| 항목 | 요구 사항 |
|---|---|
| **Android Studio** | 최신 버전 권장 (Ladybug+ / Koala+), JDK 포함 |
| **JDK** | 17 이상 (빌드 스크립트는 Java 11 타깃이지만 AGP 8.13은 JDK 17+ 필요) |
| **Android SDK** | Platform 37 (`compileSdk`), Build-Tools 34+, SDK Manager로 설치 |
| **디스크/메모리** | 디스크 여유 20GB+ 권장, RAM 8GB 이상 권장 |
| **Git** | 저장소 클론용 |

## 2. 저장소 클론

```bash
git clone https://github.com/realizer-1966/gallery.git
cd gallery/Android/src          # ← 프로젝트 루트 (settings.gradle.kts 위치)
```

> ⚠️ 프로젝트 루트는 `Android/src` 입니다. 여기서 열어야 합니다.

## 3. Android Studio로 열기

1. Android Studio 실행 → **Open** → `gallery/Android/src` 폴더 선택
2. Gradle 동기화가 자동 진행 (최초 수 분 소요, 의존성 다운로드)
3. 필요한 SDK 라이선스 수락 프롬프트가 뜨면 Accept

## 4. (선택) HuggingFace OAuth 설정 — 모델 다운로드에 필요

앱 안에서 모델(Gemma 등)을 다운로드하려면 HuggingFace 인증이 필요합니다.

1. [HuggingFace](https://huggingface.co/settings/tokens) 에서 **Developer Application** 생성
   (공식 문서: https://huggingface.co/docs/hub/oauth)
2. Redirect URL 하나 등록 (예: `com.google.aiedge.gallery://oauth2redirect`)
3. 두 파일 수정:
   - `Android/src/app/src/main/java/com/google/ai/edge/gallery/common/ProjectConfig.kt`
     → `clientId`, `redirectUri` 를 본인 값으로 교체
   - `Android/src/app/build.gradle.kts` (L41~44 근처)
     → `manifestPlaceholders["appAuthRedirectScheme"]` 를 redirect scheme과 일치시킴

> ⚠️ 이 과정을 건너뛰면 앱은 빌드되지만 모델 다운로드/음성챗에 필요한
> 인증이 안 될 수 있습니다. 특히 갤러리 앱을 그대로 쓰려면 설정 권장.

## 5. APK 빌드

**방법 A — Android Studio (권장)**
- 메뉴 `Build → Build Bundle(s)/APK(s) → Build APK(s)`
- 완료 시 알림 → `locate` 클릭 → APK 경로 확인

**방법 B — 커맨드라인**
```bash
cd gallery/Android/src
# 로컬 gradle 또는 gradlew 사용
./gradlew assembleRelease
# 또는 (JDK/sdk 환경 잡힌 경우)
gradle assembleRelease
```
- 출력: `app/build/outputs/apk/release/app-release.apk`

> 참고: 이 저장소의 release 빌드는 `signingConfig = debug` 로 되어 있어
> 자체 서명되어 바로 설치 가능합니다. (앱이 "개발자" 출처로 표시될 수 있음)

## 6. 폰에 설치

- Android 12+ 폰
- `app-release.apk` 를 폰으로 전송 (USB/클라우드/메신저)
- 폰에서 APK 탭 → **"출처를 알 수 없는 앱 허용"** 설정 후 설치
- 또는 PC에서 `adb install app-release.apk` (USB 디버깅 켜고)

## 7. 실행 확인

설치 후 앱 실행 → 갤러리 홈에서 확인:
- **모델 다운로드**: 모델 매니저에서 Gemma 등 선택 → HF 로그인 후 다운로드
- **Voice Chat**: custom task에서 `llm_voice_chat` 선택 (WebRTC 필요)
- **스킬/MCP**: Agent Chat에서 확인

---

## 트러블슈팅

| 문제 | 해결 |
|---|---|
| `SDK location not found` | `local.properties` 에 `sdk.dir=/path/to/Android/Sdk` 추가 |
| `license not accepted` | `sdkmanager --licenses` 로 수락 |
| Gradle 다운로드 느림 | 네트워크 확인, 미러 설정 |
| `google-services.json` 없음 오류 | 이미 try/catch로 감싸져 있어 **무시 가능** (커밋 `12d40c6` 확인) |
| WebRTC/Vosk 네이티브 로드 실패 | 실제 폰에서만 동작(에뮬레이터 제약 가능) |
| 메모리 부족(OOM) | `gradle.properties` 에 `org.gradle.jvmargs=-Xmx4g` 설정 |

---

## 관련 파일 요약

| 파일 | 역할 |
|---|---|
| `Android/src/settings.gradle.kts` | 프로젝트 루트 정의 (`:app`) |
| `Android/src/app/build.gradle.kts` | 앱 모듈, SDK/의존성/서명 |
| `Android/src/gradle/libs.versions.toml` | 버전 카탈로그 (litertlm 0.11.0 등) |
| `Android/src/app/.../common/ProjectConfig.kt` | HF OAuth 클라이언트 설정 |
| `Android/src/app/.../customtasks/voicechat/` | Voice Chat 커스텀 태스크 |
| `voice_llm/server/` | WebRTC signaling 서버 (PC/LAN에서 `node server.js`) |
