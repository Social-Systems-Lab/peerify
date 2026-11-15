// Run: IS_BUILD=true bun test src/lib/utils/safe-redirect.test.ts
// The login and signup ?redirectTo= (Tim, 2026-11-15). Before, the login form ran
// window.location.assign(redirectTo) on whatever the link said, so a crafted login link sent people
// to another site after they logged in (and "javascript:" was passed straight on). The signup forms
// and the "Return to page" buttons did the same. Now only a path on this site is used; anything else
// falls back to the normal start page.

import { describe, expect, test } from "bun:test";
import { isSafeRedirectPath, safeRedirectPath } from "./safe-redirect";

const START = "/circles/tim/home";

describe("safeRedirectPath", () => {
    test("an external URL falls back to the start page", () => {
        expect(safeRedirectPath("https://evil.example/login", START)).toBe(START);
        expect(safeRedirectPath("http://evil.example", START)).toBe(START);
    });

    test('"//evil.example" falls back to the start page', () => {
        expect(safeRedirectPath("//evil.example", START)).toBe(START);
        expect(safeRedirectPath("//evil.example/circles/x", START)).toBe(START);
    });

    test('"javascript:alert(1)" falls back to the start page', () => {
        expect(safeRedirectPath("javascript:alert(1)", START)).toBe(START);
        expect(safeRedirectPath("JavaScript:alert(1)", START)).toBe(START);
    });

    test("a normal path on this site is kept, with its query and fragment", () => {
        expect(safeRedirectPath("/circles/venue/events/abc", START)).toBe("/circles/venue/events/abc");
        expect(safeRedirectPath("/circles/venue/events/abc?source=noticeboard#comments", START)).toBe(
            "/circles/venue/events/abc?source=noticeboard#comments",
        );
        expect(safeRedirectPath("/", START)).toBe("/");
    });

    test("no redirectTo at all gives the start page", () => {
        expect(safeRedirectPath(null, START)).toBe(START);
        expect(safeRedirectPath(undefined, START)).toBe(START);
        expect(safeRedirectPath("", START)).toBe(START);
    });

    test("tricks browsers turn into another site are refused", () => {
        for (const value of [
            "/\\evil.example",
            "\\\\evil.example",
            " //evil.example",
            "/\t/evil.example",
            "/\n/evil.example",
            "evil.example",
            "data:text/html,hi",
        ]) {
            expect(isSafeRedirectPath(value)).toBe(false);
        }
        // An encoded newline stays encoded: a plain path on this site.
        expect(isSafeRedirectPath("/%0a/x")).toBe(true);
    });
});
