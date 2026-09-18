#!/usr/bin/env python3
"""WAV(44.1kHz) → 16kHz mono float32 raw PCM 변환기 (순수 stdlib, numpy/ffmpeg 불필요).

TTS 산출물을 ASR 서버가 받는 형식(16kHz mono f32le)으로 맞춘다.
선형 보간 리샘플 + 간단한 저역통과(이동평균)로 에일리어싱을 줄인다.

사용: python3 wav_to_f32.py in.wav out.f32 [target_rate]
"""
import sys
import wave
import struct


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    target = int(sys.argv[3]) if len(sys.argv) > 3 else 16000

    w = wave.open(src, 'rb')
    ch, sr, sw, n = w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()
    raw = w.readframes(n)
    w.close()

    if sw != 2:
        print(f"unsupported sample width {sw}", file=sys.stderr)
        return 1

    samples = list(struct.unpack('<%dh' % (len(raw) // 2), raw))
    # 다운믹스 to mono
    if ch > 1:
        samples = [sum(samples[i:i + ch]) / ch for i in range(0, len(samples), ch)]

    # 선형 보간 리샘플
    ratio = target / float(sr)
    out_n = int(len(samples) * ratio)
    out = [0.0] * out_n
    for i in range(out_n):
        pos = i / ratio
        i0 = int(pos)
        i1 = min(i0 + 1, len(samples) - 1)
        frac = pos - i0
        out[i] = samples[i0] * (1 - frac) + samples[i1] * frac

    # 저역통과: 폭 = sr/target (다운샘플 시에만)
    k = max(1, int(round(sr / float(target))))
    if k > 1:
        acc, run, smoothed = 0.0, 0, [0.0] * out_n
        for i, v in enumerate(out):
            acc += v
            run += 1
            if run > k:
                acc -= out[i - k]
                run -= 1
            smoothed[i] = acc / run
        out = smoothed

    # 정규화 (peak 기준, 클리핑 방지)
    peak = max(abs(v) for v in out) or 1.0
    scale = 30000.0 / peak if peak > 30000 else 1.0
    data = struct.pack('<%df' % out_n, *[v * scale / 32768.0 for v in out])

    with open(dst, 'wb') as f:
        f.write(data)

    print(f"{src} ({sr}Hz, {ch}ch, {n} frames) -> {dst} "
          f"({target}Hz, mono, {out_n} samples, {len(data)} bytes, {out_n/target:.2f}s)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
