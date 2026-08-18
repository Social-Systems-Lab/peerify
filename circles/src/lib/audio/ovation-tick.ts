"use client";

// A brief, quiet "tick" for ovation taps — synthesized rather than a committed
// audio asset, since the app has no existing sound-effect pipeline to reuse and
// this needs to stay short/subtle rather than a full clap sample layered over a
// currently-playing track.
//
// The AudioContext is created lazily, on the first real tap rather than on
// mount: WebKit (iOS/macOS Safari) starts a freshly-created AudioContext in a
// "suspended" state until it's resumed from inside a genuine user-gesture
// handler, so both creation and resume() happen synchronously inside the tap's
// click handler. A click handler is a real user gesture on every major
// browser/platform, so gesture-triggered playback itself is never blocked by
// autoplay policy — this is the standard, documented exception to it.
//
// Deliberately does not try to bypass the iOS hardware silent switch: WebKit's
// default "ambient" audio session category already respects it, which is the
// correct behavior for a decorative micro-interaction sound, not something to
// route around.
let sharedAudioCtx: AudioContext | null = null;

// A real clap/click is a broadband noise transient, not a pitched tone — a sine
// oscillator (the previous approach) inherently reads as a soft "boop" no matter
// how its envelope is shaped. Synthesizing a short filtered-noise burst instead
// is the standard no-asset technique for a percussive click, and gives a much
// sharper attack/decay than any oscillator-based tone can.
function createNoiseBurstBuffer(ctx: AudioContext): AudioBuffer {
    const durationSec = 0.05;
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

export function playOvationTick(): void {
    if (typeof window === "undefined") return;

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
        if (!sharedAudioCtx) {
            sharedAudioCtx = new AudioContextCtor();
        }
        if (sharedAudioCtx.state === "suspended") {
            sharedAudioCtx.resume().catch(() => {});
        }

        const ctx = sharedAudioCtx;
        const now = ctx.currentTime;

        const noise = ctx.createBufferSource();
        noise.buffer = createNoiseBurstBuffer(ctx);

        // Bandpass gives the noise a "snap" character instead of raw hiss; the
        // highpass cuts low-end rumble so it doesn't compete with the track audio.
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = "bandpass";
        bandpass.frequency.setValueAtTime(2200, now);
        bandpass.Q.setValueAtTime(0.9, now);

        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.setValueAtTime(700, now);

        const gain = ctx.createGain();
        // Near-instant attack, full decay to silence in ~45ms total — sharp
        // rather than the previous tone's comparatively slow 100ms fade.
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.28, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

        noise.connect(bandpass);
        bandpass.connect(highpass);
        highpass.connect(gain);
        gain.connect(ctx.destination);

        noise.start(now);
        noise.stop(now + 0.05);
    } catch {
        // Web Audio unavailable or blocked — the tap animation is still the
        // primary feedback, so skip the sound rather than surface an error for
        // a purely decorative extra.
    }
}
