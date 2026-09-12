// rAF handle per element currently mid-fade, keyed by the <audio> element itself. Module-level
// (not owned per-caller) so any two call sites targeting the same element — e.g. ArtistCard's
// scroll-away fade and CirclePreview's close-and-navigate fade — compose correctly: a second
// fadeOutAndPause() call for an element already fading cancels the earlier rAF loop instead of
// running two overlapping ones, no matter which caller started which.
const activeFades = new Map<HTMLAudioElement, number>();

/** Cancels any in-flight fade for this element. Safe to call on an element with no active fade. */
export function cancelFade(audio: HTMLAudioElement): void {
    const frame = activeFades.get(audio);
    if (frame !== undefined) {
        cancelAnimationFrame(frame);
        activeFades.delete(audio);
    }
}

/**
 * Ramps `audio.volume` down to 0 over `durationMs`, then pauses.
 *
 * Self-terminating by elapsed time, not by the element's paused/attached state — so a caller that
 * unmounts (or otherwise detaches) the element mid-fade never leaves a timer running past
 * `durationMs`; the loop still reaches its "t >= 1" branch, deletes its own map entry, and calls
 * `.pause()` (a harmless no-op on an already-detached element) rather than continuing indefinitely.
 * Each tick still bails early — before that natural end — if something else already paused the
 * element (audio-manager's exclusivity handler, or the user tapping play/pause), so this doesn't
 * fight whatever already handled it.
 */
export function fadeOutAndPause(audio: HTMLAudioElement, durationMs: number): void {
    cancelFade(audio);

    const startVolume = audio.volume;
    const startTime = performance.now();

    const step = (now: number) => {
        if (audio.paused) {
            activeFades.delete(audio);
            return;
        }

        const t = Math.min((now - startTime) / durationMs, 1);
        audio.volume = startVolume * (1 - t);

        if (t < 1) {
            activeFades.set(audio, requestAnimationFrame(step));
        } else {
            activeFades.delete(audio);
            audio.pause();
        }
    };

    activeFades.set(audio, requestAnimationFrame(step));
}

/**
 * Fades every currently-playing <audio> element found within `target` — or `target` itself, if
 * it's already an <audio> element rather than a container. Only elements that are actually
 * playing are touched; anything already paused is left alone.
 */
export function fadeOutPlayingAudio(target: HTMLAudioElement | Element, durationMs: number): void {
    const elements = target instanceof HTMLAudioElement ? [target] : Array.from(target.querySelectorAll("audio"));
    elements.forEach((audio) => {
        if (!audio.paused) fadeOutAndPause(audio, durationMs);
    });
}
