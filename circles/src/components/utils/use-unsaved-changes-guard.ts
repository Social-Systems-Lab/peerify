"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSetAtom } from "jotai";
import { hasUnsavedFormChangesAtom } from "@/lib/data/atoms";

const DEFAULT_MESSAGE = "You have unsaved changes. Leave without saving?";

// Warns before leaving a page with unsaved changes, however the user tries to leave:
// - tab close / reload / typing a new URL / following an external link: the browser's own
//   beforeunload prompt (its wording is fixed by the browser, not `message` — browsers haven't
//   shown a custom beforeunload message for years, for phishing-prevention reasons).
// - clicking an internal <a>/<Link>: intercepted via a capture-phase click listener, using
//   window.confirm(message).
// - the browser's back/forward buttons: intercepted via the "history buffer" trick below, also
//   using window.confirm(message).
// - global-nav items that navigate via onClick + router.push() instead of a real <a>/<Link>
//   (Feed, Events in global-nav-items.tsx) — these have no anchor for the click interceptor
//   above to catch, so `isDirty` is also mirrored into hasUnsavedFormChangesAtom
//   (src/lib/data/atoms.ts), which those onClick handlers check directly before navigating.
//
// Caveat: still doesn't catch a programmatic router.push()/router.replace() call made from
// somewhere that *doesn't* check the atom and isn't a link click — Next.js's App Router has no
// hook for intercepting navigation generically (no router.events, no usePrompt/useBlocker
// equivalent as of Next 15). Not an issue for any current caller as of 2026-09-08; if a future
// caller needs that too, this hook (and the atom) is the place to extend, not a reason to
// duplicate it.
export function useUnsavedChangesGuard(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
    const router = useRouter();
    const isDirtyRef = useRef(isDirty);
    isDirtyRef.current = isDirty;

    const setHasUnsavedFormChanges = useSetAtom(hasUnsavedFormChangesAtom);
    useEffect(() => {
        setHasUnsavedFormChanges(isDirty);
    }, [isDirty, setHasUnsavedFormChanges]);
    // Separate from the sync above so this only clears on actual unmount (leaving the page),
    // not on every isDirty flip — otherwise a save-then-immediately-edit-again sequence would
    // briefly flash the atom back to false between the two.
    useEffect(() => {
        return () => setHasUnsavedFormChanges(false);
    }, [setHasUnsavedFormChanges]);

    // Tab close / reload / typing a new URL.
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!isDirtyRef.current) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);

    // Internal <a>/<Link> clicks. Capture phase so this runs before Next's own Link click
    // handler (which calls preventDefault()+router.push() itself) gets a chance to act.
    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (!isDirtyRef.current) return;
            if (event.defaultPrevented) return;
            // Only a plain, unmodified left-click is "navigate away in this tab" — a
            // modified/middle click opens a new tab, which doesn't leave this one at all.
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return; // opens elsewhere, not a "leave"
            if (anchor.hasAttribute("download")) return;

            let destination: URL;
            try {
                destination = new URL(anchor.href, window.location.href);
            } catch {
                return;
            }
            if (destination.origin !== window.location.origin) return; // external link
            if (destination.href === window.location.href) return; // same-page anchor/no-op

            event.preventDefault();
            if (window.confirm(message)) {
                router.push(destination.pathname + destination.search + destination.hash);
            }
        };

        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
    }, [router, message]);

    // Browser back/forward — the "history buffer" trick: while dirty, keep one extra history
    // entry pushed on top of the current one, duplicating its own URL. Since it's a duplicate of
    // the SAME url (never a different route), pushing/consuming it never requires Next's router
    // to resync to a different page the way a raw pushState to a *different* URL would — the
    // first back-press against the buffer is entirely invisible (URL doesn't change), which is
    // exactly what gives us a chance to confirm before a second, real back-press actually leaves.
    // `skipNextPopRef` lets that second, self-initiated history.back() (or the cleanup back()
    // below) through without re-triggering the guard.
    const hasBufferRef = useRef(false);
    const skipNextPopRef = useRef(false);

    useEffect(() => {
        if (isDirty && !hasBufferRef.current) {
            window.history.pushState(null, "", window.location.href);
            hasBufferRef.current = true;
        } else if (!isDirty && hasBufferRef.current) {
            skipNextPopRef.current = true;
            window.history.back();
            hasBufferRef.current = false;
        }
    }, [isDirty]);

    useEffect(() => {
        const onPopState = () => {
            if (skipNextPopRef.current) {
                skipNextPopRef.current = false;
                return;
            }
            if (!isDirtyRef.current) {
                hasBufferRef.current = false;
                return;
            }

            if (window.confirm(message)) {
                skipNextPopRef.current = true;
                hasBufferRef.current = false;
                router.back();
            } else {
                // Still dirty and staying — restore the buffer so the next back-press is caught too.
                window.history.pushState(null, "", window.location.href);
            }
        };

        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [message, router]);
}
