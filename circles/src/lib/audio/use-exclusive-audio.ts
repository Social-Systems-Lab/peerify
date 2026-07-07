"use client";

import { useEffect, useId, useRef } from "react";
import { registerAudioElement } from "./audio-manager";

// Attach the returned ref to an <audio> element to make it stop all other
// registered <audio> elements site-wide when it starts playing.
export function useExclusiveAudio() {
    const id = useId();
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        const unregister = registerAudioElement(id, el);
        return unregister;
    }, [id]);

    return audioRef;
}
