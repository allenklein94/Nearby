# Generates Nearby's three in-app sound cues (owner idea "169") from pure sine tones: no samples, recordings or third-party
# material, so the files are Nearby's own work (see assets/sounds/LICENSE.md). Deterministic: re-running writes identical files.
#   python3 -I scripts/sounds/generate-sound-cues.py
import math, struct, wave, os

RATE = 44100
PEAK = 0.25  # about -12 dBFS at the loudest point: quiet next to the phone's own notification sounds
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sounds')

def note(freq, start, length, gain=1.0):
    # A soft bell-like tone: 8 ms attack, exponential decay, a quiet octave partial for warmth.
    return (freq, start, length, gain)

def render(notes, total):
    n = int(RATE * total)
    buf = [0.0] * n
    for freq, start, length, gain in notes:
        s0 = int(RATE * start)
        for i in range(int(RATE * length)):
            t = i / RATE
            env = min(1.0, t / 0.008) * math.exp(-t * 6.0 / length)
            v = math.sin(2 * math.pi * freq * t) + 0.18 * math.sin(2 * math.pi * freq * 2 * t)
            if s0 + i < n:
                buf[s0 + i] += gain * env * v
    top = max(abs(x) for x in buf) or 1.0
    fade = int(RATE * 0.02)  # 20 ms fade-out so nothing clicks at the end
    for i in range(fade):
        buf[n - 1 - i] *= i / fade
    return [x / top * PEAK for x in buf]

def write(name, samples):
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x)) * 32767)) for x in samples))

CUES = {
    # A business replied: a subtle two-note chime, rising (E6 -> A6).
    'offer-arrived.wav': ([note(1318.5, 0.0, 0.32, 0.8), note(1760.0, 0.09, 0.36, 0.7)], 0.48),
    # You booked: a brief, satisfying rising fifth (C5 -> G5) with a soft third between.
    'offer-accepted.wav': ([note(523.25, 0.0, 0.30), note(659.25, 0.07, 0.30, 0.8), note(783.99, 0.14, 0.40, 0.9)], 0.56),
    # Your visit was confirmed: one warm settling tone (G5 over C5), a completion, not a celebration.
    'visit-confirmed.wav': ([note(523.25, 0.0, 0.50, 0.6), note(783.99, 0.0, 0.50, 0.8)], 0.52),
}

if __name__ == '__main__':
    for name, (notes, total) in CUES.items():
        write(name, render(notes, total))
        print('wrote', name)
