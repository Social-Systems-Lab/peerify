"use client"

import { useEffect } from "react"

// Scroll reveal for the landing page and /hosts: adds "visible" to each element matching `selector`
// once it scrolls into view. Renders nothing; without JS nothing gets "visible", so styles keyed on it
// must leave the element readable in its default state.
export default function PeerifyReveal({ selector = ".reveal", threshold = 0.1 }: { selector?: string; threshold?: number }) {
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible") }),
            { threshold }
        )
        document.querySelectorAll(selector).forEach((el) => observer.observe(el))
        return () => observer.disconnect()
    }, [selector, threshold])

    return null
}
