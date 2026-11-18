// Run: IS_BUILD=true bun test src/components/modules/tasks/participant-notes-hint.test.ts
// Staging round fix (Tim, 2026-11-18): on a shift whose "Important for participants" is held back,
// the hint for someone not signed up said "appear once you sign up", but signing up isn't enough:
// on a crew-only shift the notes go to confirmed participants only (decision B). Now: "appear once
// you're confirmed". A pending sign-up keeps "once an organiser confirms your sign-up".

import { expect, test } from "bun:test";
import * as utils from "./shift-task-utils";

const hint = (isSignedUp: boolean) => {
    const fn = (utils as unknown as Record<string, unknown>).getParticipantNotesHiddenHint;
    if (typeof fn !== "function") throw new Error("shift-task-utils has no getParticipantNotesHiddenHint");
    return (fn as (isSignedUp: boolean) => string)(isSignedUp);
};

test("not signed up: once you're confirmed", () => {
    expect(hint(false)).toBe("Details for participants appear once you’re confirmed.");
});

test("signed up, pending: once an organiser confirms your sign-up", () => {
    expect(hint(true)).toBe("Details for participants appear once an organiser confirms your sign-up.");
});
