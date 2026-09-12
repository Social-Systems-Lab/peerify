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
