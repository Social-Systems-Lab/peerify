import { describe, expect, test } from "bun:test";
import { isErrorToast, reducer, withErrorDefaults } from "./use-toast";

const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, open: true, ...extra }) as any;
const error = (id: string) => t(id, { variant: "destructive" });
const add = (toasts: any[], toast: any) => reducer({ toasts }, { type: "ADD_TOAST", toast }).toasts;
const ids = (toasts: any[]) => toasts.map((x) => x.id);

describe("error toasts stay until dismissed", () => {
    test("destructive or icon error counts as an error", () => {
        expect(isErrorToast({ variant: "destructive" })).toBe(true);
        expect(isErrorToast({ icon: "error" })).toBe(true);
        expect(isErrorToast({ icon: "success" })).toBe(false);
        expect(isErrorToast({})).toBe(false);
    });

    test("an error gets no timeout and the error style", () => {
        expect(withErrorDefaults({ variant: "destructive" })).toEqual({
            variant: "destructive",
            duration: Number.POSITIVE_INFINITY,
        });
        expect(withErrorDefaults({ icon: "error" })).toEqual({
            icon: "error",
            variant: "destructive",
            duration: Number.POSITIVE_INFINITY,
        });
    });

    test("a caller's own duration is kept", () => {
        expect(withErrorDefaults({ variant: "destructive", duration: 8000 }).duration).toBe(8000);
    });

    test("other toasts are left alone (Radix's 5-second timeout)", () => {
        expect(withErrorDefaults({ icon: "success" })).toEqual({ icon: "success" });
    });
});

describe("several toasts at once", () => {
    test("a new toast no longer replaces an error", () => {
        expect(ids(add([error("e1")], t("s1")))).toEqual(["s1", "e1"]);
    });

    test("at most three; the oldest non-error goes first", () => {
        const now = [t("s2"), error("e1"), t("s1")]; // newest first
        expect(ids(add(now, t("s3")))).toEqual(["s3", "s2", "e1"]);
        expect(ids(add([t("s2"), t("s1"), error("e1")], t("s3")))).toEqual(["s3", "s2", "e1"]);
    });

    test("when all are errors, the oldest error goes", () => {
        expect(ids(add([error("e3"), error("e2"), error("e1")], error("e4")))).toEqual(["e4", "e3", "e2"]);
    });

    test("closed toasts don't take a place", () => {
        const closed = (id: string) => t(id, { open: false });
        expect(ids(add([closed("c1"), closed("c2"), error("e1")], t("s1")))).toEqual(["s1", "e1"]);
    });
});
