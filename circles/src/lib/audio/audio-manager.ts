// Module-level singleton so playing one <audio> element site-wide pauses all others.
const registry = new Map<string, HTMLAudioElement>();

export function registerAudioElement(id: string, el: HTMLAudioElement): () => void {
    registry.set(id, el);

    const handlePlay = () => {
        // .volume is a persistent property that never resets on its own — without this, a track
        // faded to 0 by ArtistCard's scroll-away fade (artist-card.tsx) would silently resume at
        // 0 volume the next time it plays. General correctness fix, not specific to that fade:
        // any track starting should always be audible, regardless of what its volume was left at.
        el.volume = 1;

        registry.forEach((otherEl, otherId) => {
            if (otherId !== id && !otherEl.paused) {
                otherEl.pause();
            }
        });
    };

    el.addEventListener("play", handlePlay);

    return () => {
        el.removeEventListener("play", handlePlay);
        if (registry.get(id) === el) {
            registry.delete(id);
        }
    };
}

/**
 * Every <audio> element currently registered for exclusive playback, in no particular order.
 * Since this registry enforces site-wide exclusivity (at most one entry is ever playing), this is
 * the reliable way to find "whichever track is currently playing" without needing to know which
 * component rendered it — a DOM-subtree sweep only works if the caller happens to contain the
 * right element, which isn't guaranteed (e.g. CirclePreview's close-and-navigate fade needs this:
 * playback started from ArtistCard's own compact play button, a sibling of the expanded
 * CirclePreview it renders, not a descendant of it).
 */
export function getRegisteredAudioElements(): HTMLAudioElement[] {
    return Array.from(registry.values());
}
