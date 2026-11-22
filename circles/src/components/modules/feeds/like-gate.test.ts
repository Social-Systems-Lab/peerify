// Run: IS_BUILD=true bun test src/components/modules/feeds/like-gate.test.ts
// The like buttons' check (2026-11-22): a like that the server would refuse only because the
// profile isn't verified shows UNVERIFIED_PROFILE_EXPLAINER instead of liking and silently undoing.
// Other refusals (not a member of a Community, signed out) aren't this case.

import { describe, expect, test } from "bun:test";
import { UNVERIFIED_PROFILE_EXPLAINER } from "@/lib/auth/verification";
import type { Circle, UserPrivate } from "@/models/models";
import { isLikeBlockedUntilVerified, isUnverifiedRefusal } from "./like-gate";

const circle = { _id: "circle-1", handle: "band", accessRules: {} } as unknown as Circle;
const person = (verified: boolean, groups: string[] = []) =>
    ({
        _id: "user-1",
        did: "did:test:user",
        verificationStatus: verified ? "verified" : "unverified",
        memberships: groups.length ? [{ circleId: "circle-1", userGroups: groups }] : [],
    }) as unknown as UserPrivate;

describe("isLikeBlockedUntilVerified", () => {
    test("an unverified profile on a Noticeboard or Forum post: blocked, show the explanation", () => {
        expect(isLikeBlockedUntilVerified(person(false), circle)).toBe(true);
        expect(isLikeBlockedUntilVerified(person(false), circle, "discussion")).toBe(true);
    });

    test("a verified profile: not blocked", () => {
        expect(isLikeBlockedUntilVerified(person(true), circle)).toBe(false);
    });

    test("Community: an unverified member is blocked, a non-member isn't (that's not a verification problem)", () => {
        expect(isLikeBlockedUntilVerified(person(false, ["members"]), circle, "community")).toBe(true);
        expect(isLikeBlockedUntilVerified(person(false), circle, "community")).toBe(false);
    });

    test("signed out or no circle: not this case", () => {
        expect(isLikeBlockedUntilVerified(undefined, circle)).toBe(false);
        expect(isLikeBlockedUntilVerified(person(false), undefined)).toBe(false);
    });
});

describe("isUnverifiedRefusal", () => {
    test("only a refusal carrying the explanation", () => {
        expect(isUnverifiedRefusal({ success: false, message: UNVERIFIED_PROFILE_EXPLAINER })).toBe(true);
        expect(isUnverifiedRefusal({ success: false, message: "Post not found" })).toBe(false);
        expect(isUnverifiedRefusal({ success: true, message: UNVERIFIED_PROFILE_EXPLAINER })).toBe(false);
    });
});
