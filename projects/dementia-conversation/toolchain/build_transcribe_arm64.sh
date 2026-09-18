#!/usr/bin/env bash
# Build transcribe.cpp for aarch64 CPU on this proot device.
#
# Why zig: this proot image has no gcc/clang and apt has no candidates for
# build-essential/cmake. The ziglang wheel ships a self-contained aarch64
# toolchain, so `pip install ziglang` is the only working compiler source.
#
# Three wrapper scripts work around proot-specific breakage:
#   zig-cc / zig-cxx  strip -MD/-MMD/-MT/-MF (zig 0.16 segfaults emitting a
#                     depfile here; CMake passes them unconditionally)
#   zig-ar / zig-ranlib  map CMake's `ar`/`ranlib` calls onto `zig ar`/`zig ranlib`
#                     (CMAKE_AR-NOTFOUND otherwise)
set -eu
source /root/workspace/.toolchain-venv/bin/activate
export ZIGCC_ZIG="$(python -c "import ziglang,os;print(os.path.join(os.path.dirname(ziglang.__file__),'zig'))")"
T=/root/workspace/toolchain
cd /root/workspace/transcribe.cpp

cmake -S . -B build/linux-arm64-cpu -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$T/zig-cc" \
  -DCMAKE_CXX_COMPILER="$T/zig-cxx" \
  -DCMAKE_AR="$T/zig-ar" \
  -DCMAKE_RANLIB="$T/zig-ranlib" \
  -DCMAKE_C_FLAGS="-w" \
  -DCMAKE_CXX_FLAGS="-w" \
  -DTRANSCRIBE_BUILD_TESTS=OFF \
  -DTRANSCRIBE_METAL=OFF \
  -DTRANSCRIBE_VULKAN=OFF \
  -DTRANSCRIBE_CUDA=OFF \
  -DTRANSCRIBE_HIP=OFF \
  -DTRANSCRIBE_USE_OPENMP=OFF

cmake --build build/linux-arm64-cpu --parallel 5
