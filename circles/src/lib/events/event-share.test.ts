// Run: IS_BUILD=true bun test src/lib/events/event-share.test.ts
// Crew R1, item 5 (2026-11-14): the event share text and the "Sign in to RSVP" link.

import { describe, expect, test } from "bun:test";
import {
    buildEventSharePayload,
    buildEventShareText,
    chooseEventShareMode,
    detectEventShareMode,
    eventSignInHref,
    TOUCH_FIRST_QUERY,
} from "./event-share";

const STREET = "Canary Street 12";
const NOTE = "CANARY private organiser note";

const event = (extra: Record<string, unknown> = {}) =>
    ({
        title: "Julian Wenn – house concert",
        startAt: new Date(2026, 11, 5, 19, 30),
        isVirtual: false,
        location: {
            precision: 4,
            city: "Stockholm",
            country: "Sweden",
            street: STREET,
            lngLat: { lng: 18.07, lat: 59.33 },
        },
        metadata: { peerify: { privateLocationNote: NOTE, guestNote: `${NOTE} for guests` } },
        ...extra,
    }) as Parameters<typeof buildEventShareText>[0];

const URL = "https://peerify.one/circles/host/events/abc";

describe("share text", () => {
    test("has the title, the date and time, the city and the link", () => {
        const text = buildEventShareText(event(), URL);
        expect(text).toBe("Julian Wenn – house concert\nSat 5 Dec, 19:30 · Stockholm, Sweden\n" + URL);
    });

    test("never has the street, the coordinates or the private note, even when the viewer has them", () => {
        const text = buildEventShareText(event(), URL);
        expect(text).not.toContain(STREET);
        expect(text).not.toContain("18.07");
        expect(text).not.toContain(NOTE);
    });

    test("uses the organiser's public label when there is one", () => {
        const text = buildEventShareText(event({ metadata: { peerify: { publicLocationLabel: "Södermalm" } } }), URL);
        expect(text).toContain("Södermalm");
        expect(text).not.toContain("Stockholm");
    });

    test("an online event says Online", () => {
        expect(buildEventShareText(event({ isVirtual: true }), URL)).toContain("Online");
    });
});

describe("Sign in to RSVP", () => {
    test("links to the login page and comes back to the event", () => {
        expect(eventSignInHref("host", "abc")).toBe("/login?redirectTo=%2Fcircles%2Fhost%2Fevents%2Fabc");
    });
});

describe("the share sheet payload (2026-11-15)", () => {
    test("the title appears once: no separate title (macOS put it in front of the text)", () => {
        const payload = buildEventSharePayload(event(), URL);
        const all = [payload.title, payload.text, payload.url].filter(Boolean).join("\n");
        expect(all.split("Julian Wenn – house concert").length - 1).toBe(1);
        expect(all.split(URL).length - 1).toBe(1);
        expect(payload.text).toBe(buildEventShareText(event(), URL));
    });
});

describe("one Share button: share sheet on phones, link dialog on desktop (2026-11-15)", () => {
    test("the share sheet only on a touch-first device that has one", () => {
        expect(chooseEventShareMode({ canShare: true, touchFirst: true })).toBe("sheet");
        // Safari on the Mac has a share sheet, but desktop gets the dialog.
        expect(chooseEventShareMode({ canShare: true, touchFirst: false })).toBe("dialog");
        // A phone browser without one falls back to the dialog.
        expect(chooseEventShareMode({ canShare: false, touchFirst: true })).toBe("dialog");
        expect(chooseEventShareMode({ canShare: false, touchFirst: false })).toBe("dialog");
    });

    test("read from the browser: share function plus the touch-first media query", () => {
        const media = (touch: boolean) => (q: string) => ({ matches: touch && q === TOUCH_FIRST_QUERY });
        const share = () => Promise.resolve();
        expect(detectEventShareMode({ share }, media(true))).toBe("sheet");
        expect(detectEventShareMode({ share }, media(false))).toBe("dialog");
        expect(detectEventShareMode({}, media(true))).toBe("dialog");
        expect(detectEventShareMode(undefined, undefined)).toBe("dialog");
        expect(detectEventShareMode({ share }, undefined)).toBe("dialog");
    });

    test("what the phone's share sheet gets never has the street, the pin or the private note", () => {
        for (const e of [
            event(),
            event({
                metadata: {
                    peerify: {
                        privateLocationNote: NOTE,
                        guestNote: `${NOTE} for guests`,
                        publicLocationLabel: "Södermalm",
                    },
                },
            }),
        ]) {
            const payload = buildEventSharePayload(e, URL);
            const all = JSON.stringify(payload);
            expect(all).not.toContain(STREET);
            expect(all).not.toContain("18.07");
            expect(all).not.toContain("59.33");
            expect(all).not.toContain(NOTE);
            expect(all.split(URL).length - 1).toBe(1);
        }
    });
});
