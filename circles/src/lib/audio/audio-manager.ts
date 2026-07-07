// Module-level singleton so playing one <audio> element site-wide pauses all others.
const registry = new Map<string, HTMLAudioElement>();

export function registerAudioElement(id: string, el: HTMLAudioElement): () => void {
    registry.set(id, el);

    const handlePlay = () => {
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
