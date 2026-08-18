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
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.08);

        // Exponential ramps can't target 0 exactly, hence the near-zero floor —
        // this also avoids the click/pop an abrupt gain change would cause.
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.1);
    } catch {
        // Web Audio unavailable or blocked — the tap animation is still the
        // primary feedback, so skip the sound rather than surface an error for
        // a purely decorative extra.
    }
}
