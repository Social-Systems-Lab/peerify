// Run: IS_BUILD=true bun test src/lib/events/event-audience-copy.test.ts
// Crew R1, item 9 (2026-11-14): the event audience picker said it "only controls the linked
// Noticeboard post", but since H5 it also decides who can see the event.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { EVENT_AUDIENCE_COPY } from "./event-audience-copy";

describe("event audience picker wording", () => {
    test("says it decides who can see the event, not only the post", () => {
        expect(EVENT_AUDIENCE_COPY.dialogTitle).toBe("Who can see this event?");
        expect(EVENT_AUDIENCE_COPY.dialogBody).toContain("who can see the event itself");
        expect(EVENT_AUDIENCE_COPY.buttonPrefix).toBe("Visible to:");
    });

    test("the event form uses it and no longer says the picker only controls the post", () => {
        const form = readFileSync(join(process.cwd(), "src/components/modules/events/event-form.tsx"), "utf8");
        expect(form).toContain("EVENT_AUDIENCE_COPY.dialogBody");
        expect(form).not.toContain("This only controls the linked Noticeboard post");
        expect(form).not.toContain("Post visible to:");
    });
});
