// Run: IS_BUILD=true bun test src/lib/tasks/crew-shifts-view.test.ts
// Crew round 2, commit 5 (2026-11-18): the data for the Crew page's "Shifts & tasks" view
// (summarizeCrewShiftsView). Pure: tasks are already filtered by filterTasksForViewer, events by
// shapeEventsForViewer. Covers ordering and grouping by event, hidden events ("Other"), past and
// filled shifts (F2, F8), tasks (F4), the viewer's statuses, organiser-only names, and that no
// location, note, description or claim ever reaches the result.

import { describe, expect, test } from "bun:test";
import type { TaskDisplay } from "@/models/models";
import { summarizeCrewShiftsView, type CrewShiftsView } from "./crew-shifts-view";

const ME = "did:test:me";
const OTHER = "did:test:other";
const DAY = 86_400_000;
const now = new Date("2026-12-01T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * DAY);

const E_LATE = { _id: "e-late", title: "Home show", startAt: day(5) };
const E_EARLY = { _id: "e-early", title: "Soundcheck evening", startAt: day(2) };
const events = [E_LATE, E_EARLY];

const CANARY = "CANARY-4711";
let seq = 0;
const shift = (extra: Partial<TaskDisplay> & Record<string, unknown> = {}): TaskDisplay =>
    ({
        _id: `s${++seq}`,
        circleId: "c",
        createdBy: OTHER,
        title: `Shift ${seq}`,
        description: `${CANARY} description`,
        taskType: "shift",
        stage: "open",
        userGroups: ["admins", "moderators", "crew"],
        slots: 2,
        shiftStartTime: "18:00",
        shiftDurationMinutes: 120,
        targetDate: day(5),
        eventId: "e-late",
        participants: [],
        location: { street: `${CANARY} street`, city: "Cape Town" },
        participantNotes: `${CANARY} door code`,
        ...extra,
    }) as unknown as TaskDisplay;
const task = (extra: Partial<TaskDisplay> & Record<string, unknown> = {}): TaskDisplay =>
    ({
        _id: `t${++seq}`,
        circleId: "c",
        createdBy: OTHER,
        title: `Task ${seq}`,
        description: `${CANARY} description`,
        taskType: "outcome",
        stage: "open",
        userGroups: ["everyone"],
        targetDate: day(5),
        eventId: "e-late",
        claims: [],
        location: { street: `${CANARY} street` },
        ...extra,
    }) as unknown as TaskDisplay;

const joined = day(-3);
const pending = (userDid: string) => ({ userDid, joinedAt: joined });
const confirmed = (userDid: string) => ({ userDid, joinedAt: joined, verifiedAt: joined });

const view = (tasks: TaskDisplay[], isOrganiser = false) =>
    summarizeCrewShiftsView(tasks, events, { viewerDid: ME, isOrganiser, now });
const titles = (v: CrewShiftsView) =>
    v.openByEvent.map((g) => [
        g.event?.title ?? "Other",
        ...g.shifts.map((s) => s.title),
        ...g.tasks.map((t) => t.title),
    ]);

const allKeys = (value: unknown, keys = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
    else if (value && typeof value === "object")
        for (const [k, v] of Object.entries(value)) {
            keys.add(k);
            allKeys(v, keys);
        }
    return keys;
};

describe("open shifts, grouped by event", () => {
    test("events in date order, shifts soonest first within each, 'Other' last", () => {
        const a = shift({ title: "Bar", eventId: "e-late", targetDate: day(5), shiftStartTime: "20:00" });
        const b = shift({ title: "Door", eventId: "e-late", targetDate: day(5), shiftStartTime: "18:00" });
        const c = shift({ title: "Setup", eventId: "e-early", targetDate: day(2) });
        const d = shift({ title: "Loose", eventId: undefined, targetDate: day(1) });
        expect(titles(view([a, b, c, d]))).toEqual([
            ["Soundcheck evening", "Setup"],
            ["Home show", "Door", "Bar"],
            ["Other", "Loose"],
        ]);
    });

    test("a shift whose event the viewer can't see goes under 'Other', without the event id", () => {
        const hidden = shift({ title: "Secret door", eventId: "e-hidden" });
        const v = view([hidden]);
        expect(v.openByEvent).toHaveLength(1);
        expect(v.openByEvent[0].event).toBeNull();
        expect(v.openByEvent[0].shifts[0].eventId).toBeUndefined();
        expect(JSON.stringify(v)).not.toContain("e-hidden");
    });

    test("left out: past, started, in review, resolved, and without a schedule", () => {
        const past = shift({ title: "Past", targetDate: day(-2) });
        const started = shift({
            title: "Started",
            targetDate: now,
            shiftStartTime: "00:00",
            shiftDurationMinutes: 240 * 6,
        });
        const review = shift({ title: "Review", stage: "review" });
        const resolved = shift({ title: "Resolved", stage: "resolved" });
        const unscheduled = shift({ title: "Unscheduled", shiftStartTime: undefined });
        const ok = shift({ title: "Fine" });
        expect(titles(view([past, started, review, resolved, unscheduled, ok]))).toEqual([["Home show", "Fine"]]);
    });

    test("F2: all places confirmed leaves 'Open shifts'; more pending than places doesn't", () => {
        const full = shift({ title: "Full", participants: [confirmed("a"), confirmed("b"), pending("c")] });
        const offered = shift({ title: "Over-subscribed", participants: [pending("a"), pending("b"), pending("c")] });
        expect(titles(view([full, offered]))).toEqual([["Home show", "Over-subscribed"]]);
    });

    test("F5: a shift at the sign-up ceiling leaves 'Open shifts'", () => {
        const many = shift({ title: "Many", participants: [], pendingParticipantCount: 10 });
        expect(view([many]).openByEvent).toEqual([]);
    });

    test("places left count confirmed only (F3 data)", () => {
        const s = shift({ participants: [confirmed("a")], pendingParticipantCount: 4 });
        const item = view([s]).openByEvent[0].shifts[0];
        expect(item.slots).toBe(2);
        expect(item.confirmedCount).toBe(1);
        expect(item.openPlaces).toBe(1);
    });
});

describe("my shifts (F8: upcoming only)", () => {
    test("my pending and confirmed shifts, soonest first, and not repeated under 'Open shifts'", () => {
        const later = shift({ title: "Later", targetDate: day(6), participants: [confirmed(ME)] });
        const sooner = shift({ title: "Sooner", targetDate: day(3), participants: [pending(ME)] });
        const v = view([later, sooner]);
        expect(v.myShifts.map((s) => [s.title, s.viewerStatus])).toEqual([
            ["Sooner", "pending"],
            ["Later", "confirmed"],
        ]);
        expect(v.openByEvent).toEqual([]);
    });

    test("pending on a shift whose places are all confirmed: 'waitingList'", () => {
        const s = shift({ participants: [confirmed("a"), confirmed("b"), pending(ME)] });
        expect(view([s]).myShifts[0].viewerStatus).toBe("waitingList");
    });

    test("a shift in progress stays in 'My shifts'; a finished one doesn't", () => {
        const running = shift({
            title: "Running",
            targetDate: now,
            shiftStartTime: "00:00",
            shiftDurationMinutes: 24 * 60 - 1,
            participants: [confirmed(ME)],
        });
        const done = shift({ title: "Done", targetDate: day(-1), participants: [confirmed(ME)] });
        const titlesMine = view([running, done]).myShifts.map((s) => s.title);
        expect(titlesMine).toContain("Running");
        expect(titlesMine).not.toContain("Done");
    });
});

describe("tasks (F4)", () => {
    test("open unassigned tasks appear under their event; tasks without a visible event don't", () => {
        const linked = task({ title: "Bring a PA" });
        const unlinked = task({ title: "General chore", eventId: undefined });
        const hiddenEvent = task({ title: "Hidden event task", eventId: "e-hidden" });
        expect(titles(view([linked, unlinked, hiddenEvent]))).toEqual([["Home show", "Bring a PA"]]);
    });

    test("my pending claim and tasks assigned to me go to 'My shifts', not 'Open shifts'", () => {
        const claimed = task({
            title: "Claimed",
            claims: [{ claimId: "k", claimantDid: ME, status: "pending", createdAt: joined }],
        });
        const assigned = task({ title: "Mine", assignedTo: ME, stage: "inProgress" });
        const v = view([claimed, assigned]);
        expect(v.myShifts.map((t) => [t.title, t.viewerStatus])).toEqual([
            ["Claimed", "claimPending"],
            ["Mine", "assigned"],
        ]);
        expect(v.openByEvent).toEqual([]);
    });

    test("left out: assigned to someone else, resolved, in review, and past", () => {
        const others = task({ title: "Others", assignedTo: OTHER });
        const resolved = task({ title: "Resolved", stage: "resolved" });
        const review = task({ title: "Review", stage: "review" });
        const past = task({ title: "Past", targetDate: day(-2) });
        expect(view([others, resolved, review, past]).openByEvent).toEqual([]);
    });
});

describe("what never reaches the browser", () => {
    const everything = () => [
        shift({ participants: [confirmed(ME), pending(OTHER)] }),
        shift({ participants: [pending(ME)] }),
        shift({ eventId: undefined }),
        task({ claims: [{ claimId: "k", claimantDid: OTHER, status: "pending", createdAt: joined, note: CANARY }] }),
        task({ assignedTo: ME, stage: "inProgress" }),
    ];

    test("no location, notes, description, claims or participants, for crew and organisers alike", () => {
        for (const isOrganiser of [false, true]) {
            const v = view(everything(), isOrganiser);
            expect(JSON.stringify(v)).not.toContain(CANARY);
            const keys = allKeys(v);
            for (const forbidden of [
                "location",
                "participantNotes",
                "participantNotesHidden",
                "description",
                "claims",
                "participants",
                "pendingParticipantCount",
            ]) {
                expect(keys.has(forbidden)).toBe(false);
            }
        }
    });

    test("crew get no names, no DIDs of others, no pending counts and no organiser list", () => {
        const v = view(everything(), false);
        const keys = allKeys(v);
        for (const forbidden of ["people", "did", "pendingCount", "pendingClaimCount", "assigneeName", "allByEvent"]) {
            expect(keys.has(forbidden)).toBe(false);
        }
        expect(JSON.stringify(v)).not.toContain(OTHER);
    });
});

describe("organisers", () => {
    test("names and pending counts per shift; allByEvent includes filled shifts and open tasks", () => {
        const profiles = new Map([
            ["a", { did: "a", name: "Ada", handle: "ada" }],
            ["b", { did: "b", name: "Bo", handle: "bo" }],
        ]) as unknown as Map<string, never>;
        const full = shift({ title: "Full", participants: [confirmed("a"), confirmed("b"), pending("c")] });
        const pa = task({
            title: "Bring a PA",
            claims: [{ claimId: "k", claimantDid: "c", status: "pending", createdAt: joined }],
        });
        const v = summarizeCrewShiftsView([full, pa], events, {
            viewerDid: ME,
            isOrganiser: true,
            now,
            profilesByDid: profiles,
        });
        // The filled shift isn't open; the task still is (claims are open until someone is chosen).
        expect(v.openByEvent.flatMap((g) => g.shifts)).toEqual([]);
        expect(v.openByEvent.flatMap((g) => g.tasks.map((t) => t.title))).toEqual(["Bring a PA"]);
        const group = v.allByEvent?.[0];
        expect(group?.event?.title).toBe("Home show");
        const item = group?.shifts[0];
        expect(item?.pendingCount).toBe(1);
        expect(item?.people?.map((p) => [p.name ?? p.did, p.status])).toEqual([
            ["Ada", "confirmed"],
            ["Bo", "confirmed"],
            ["c", "pending"],
        ]);
        expect(group?.tasks[0].pendingClaimCount).toBe(1);
    });
});
