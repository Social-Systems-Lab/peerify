"use client"

import { useEffect } from "react"

// Landing page scroll reveal: adds "visible" to each .reveal section once it scrolls into view.
// Renders nothing.
export default function PeerifyReveal() {
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible") }),
            { threshold: 0.1 }
        )
        document.querySelectorAll(".reveal").forEach((el) => observer.observe(el))
        return () => observer.disconnect()
    }, [])

    return null
}
