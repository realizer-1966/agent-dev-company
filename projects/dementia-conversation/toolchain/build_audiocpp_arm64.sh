#!/usr/bin/env bash
# Build audio.cpp (TTS engine) for aarch64 CPU on this proot device.
#
# Only the model families actually needed are compiled (AUDIOCPP_MODEL_SET=custom).
# silero_vad / marblenet_vad are Bundled and are NOT valid custom entries — the
# VAD family registered through audiocpp_add_model() is `pulsevad`.
set -eu
source /root/workspace/.toolchain-venv/bin/activate
export ZIGCC_ZIG="$(python -c "import ziglang,os;print(os.path.join(os.path.dirname(ziglang.__file__),'zig'))")"
T=/root/workspace/toolchain
cd /root/workspace/audio.cpp
rm -rf build/linux-arm64-cpu

cmake -S . -B build/linux-arm64-cpu -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$T/zig-cc" \
  -DCMAKE_CXX_COMPILER="$T/zig-cxx" \
  -DCMAKE_AR="$T/zig-ar" \
  -DCMAKE_RANLIB="$T/zig-ranlib" \
  -DCMAKE_C_FLAGS="-w" \
  -DCMAKE_CXX_FLAGS="-w" \
  -DENGINE_ENABLE_CUDA=OFF \
  -DENGINE_ENABLE_VULKAN=OFF \
  -DENGINE_ENABLE_METAL=OFF \
  -DENGINE_ENABLE_HIP=OFF \
  -DENGINE_ENABLE_OPENMP=OFF \
  -DAUDIOCPP_MODEL_SET=custom \
  -DAUDIOCPP_MODELS=supertonic,qwen3_asr,pulsevad

# CMake records CMAKE_AR as NOTFOUND in rules.ninja despite -DCMAKE_AR;
# patch it before building (see VERIFICATION.md problem 2).
python3 - <<'PY'
import pathlib
p = pathlib.Path('/root/workspace/audio.cpp/build/linux-arm64-cpu/CMakeFiles/rules.ninja')
if p.exists():
    s = p.read_text()
    n = s.count('CMAKE_AR-NOTFOUND')
    if n:
        p.write_text(s.replace('CMAKE_AR-NOTFOUND', '/root/workspace/toolchain/zig-ar'))
        print(f'patched {n} CMAKE_AR-NOTFOUND occurrences')
    else:
        print('no CMAKE_AR-NOTFOUND found')
PY

cmake --build build/linux-arm64-cpu --parallel 5 --target audiocpp_cli audiocpp_server
