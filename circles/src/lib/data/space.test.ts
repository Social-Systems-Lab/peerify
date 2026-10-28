// Run: IS_BUILD=true bun test src/lib/data/space.test.ts
// Spaces data layer and input rules (lib/data/space.ts, lib/spaces/space-rules.ts). The database is
// in-memory fakes (testing/fake-db.ts). Privacy checks read the RAW stored documents, not what a
// function returns, so a value that is merely hidden on the way out would still fail them.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";
import { ObjectId } from "mongodb";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { coarsenLngLat } = await import("@/lib/utils");
const { parseSpaceInput, toAreaOnlyLocation } = await import("@/lib/spaces/space-rules");
const { createSpaceForOwner, deleteSpaceForOwner, getSpaceActor, listSpacesForOwner, updateSpaceForOwner, SPACES_PER_PERSON_MAX } =
    await import("./space");

const ALICE = "did:test:alice";
const BOB = "did:test:bob";

// A real-looking exact point (a street in central Stockholm) with everything a picker can send.
const EXACT = {
    precision: 4,
    country: "Sweden",
    countryCode: "SE",
    region: "Stockholm",
    city: "Stockholm",
    street: "Drottninggatan 53",
    lngLat: { lng: 18.06324, lat: 59.33258 },
    exactConfirmedAt: new Date("2026-10-01T00:00:00Z"),
};

const privateInput = (overrides: Record<string, unknown> = {}) => ({
    type: "private",
    location: EXACT,
    capacity: 25,
    setting: ["indoor"],
    amplification: "acoustic_only",
    noiseCurfew: "22:00",
    stepFreeAccess: "stairs_involved",
    notesForPeerify: "Ring the bell twice",
    dealPreferences: ["takings_share", "food_drinks"],
    listeningRuleAccepted: true,
    hostResponsibilityAccepted: true,
    ...overrides,
});

const popupInput = (overrides: Record<string, unknown> = {}) => ({
    type: "popup",
    name: "Kafé Lyssna",
    location: EXACT,
    capacity: 60,
    showTimes: "Sunday evenings after closing",
    noiseLimits: "Quiet after 23:00",
    powerAvailable: true,
    paAvailable: false,
    dealPreferences: ["fixed_fee"],
    listeningRuleAccepted: true,
    hostResponsibilityAccepted: true,
    ...overrides,
});

const parsed = (raw: unknown) => {
    const result = parseSpaceInput(raw);
    if (!result.ok) throw new Error(result.error);
    return result.value;
};

const stored = () => fakeDb.col("Spaces").docs;

beforeEach(() => fakeDb.reset());

describe("area rounding (private spaces)", () => {
    test("snaps to the 0.1° grid, City precision, no street or exact confirmation", () => {
        expect(toAreaOnlyLocation(EXACT)).toEqual({
            precision: 2,
            country: "Sweden",
            countryCode: "SE",
            region: "Stockholm",
            city: "Stockholm",
            lngLat: { lng: 18.1, lat: 59.3 },
        });
    });

    test("no usable point: nothing", () => {
        expect(toAreaOnlyLocation(undefined)).toBeUndefined();
        expect(toAreaOnlyLocation({ precision: 2, city: "Malmö" })).toBeUndefined();
        expect(toAreaOnlyLocation({ precision: 2, lngLat: { lng: NaN, lat: 55 } })).toBeUndefined();
    });

    test("the public pin grid is unchanged (0.05°)", () => {
        expect(coarsenLngLat({ lng: 18.06324, lat: 59.33258 })).toEqual({ lng: 18.05, lat: 59.35 });
    });

    test("a created private space stores only the rounded area", async () => {
        await createSpaceForOwner(ALICE, parsed(privateInput()));
        const raw = stored()[0];
        expect(raw.location).toEqual({
            precision: 2,
            country: "Sweden",
            countryCode: "SE",
            region: "Stockholm",
            city: "Stockholm",
            lngLat: { lng: 18.1, lat: 59.3 },
        });
        const text = JSON.stringify(raw);
        expect(text).not.toContain("Drottninggatan");
        expect(text).not.toContain("18.06324");
        expect(text).not.toContain("59.33258");
        expect(text).not.toContain("exactConfirmedAt");
    });

    test("an edit is rounded too", async () => {
        const { id } = (await createSpaceForOwner(ALICE, parsed(privateInput()))) as { id: string };
        const moved = { ...EXACT, street: "Storgatan 1", lngLat: { lng: 13.00071, lat: 55.60498 }, city: "Malmö" };
        expect(await updateSpaceForOwner(ALICE, id, parsed(privateInput({ location: moved })))).toBe(true);
        const text = JSON.stringify(stored()[0]);
        expect(stored()[0].location.lngLat).toEqual({ lng: 13, lat: 55.6 });
        expect(text).not.toContain("Storgatan");
        expect(text).not.toContain("13.00071");
    });
});

describe("parseSpaceInput", () => {
    test("drops fields a client adds (ownerDid, _id, dates)", () => {
        const value = parsed({ ...privateInput(), ownerDid: BOB, _id: "x", createdAt: "2020-01-01", isAdmin: true });
        expect("ownerDid" in value).toBe(false);
        expect("_id" in value).toBe(false);
        expect("createdAt" in value).toBe(false);
        expect("isAdmin" in value).toBe(false);
    });

    test("a pop-up keeps its exact location but not the public confirmation", () => {
        const value = parsed(popupInput());
        expect(value.location).toEqual({
            precision: 4,
            country: "Sweden",
            countryCode: "SE",
            region: "Stockholm",
            city: "Stockholm",
            street: "Drottninggatan 53",
            lngLat: { lng: 18.06324, lat: 59.33258 },
        });
    });

    test("both checkboxes are required", () => {
        expect(parseSpaceInput(privateInput({ listeningRuleAccepted: false })).ok).toBe(false);
        expect(parseSpaceInput(privateInput({ hostResponsibilityAccepted: undefined })).ok).toBe(false);
        expect(parseSpaceInput(popupInput({ listeningRuleAccepted: "yes" })).ok).toBe(false);
    });

    test('deal preference: several allowed, "none" stands alone, at least one', () => {
        expect(parsed(privateInput({ dealPreferences: ["fixed_fee", "fixed_fee", "food_drinks"] })).dealPreferences).toEqual([
            "fixed_fee",
            "food_drinks",
        ]);
        expect(parsed(privateInput({ dealPreferences: ["none"] })).dealPreferences).toEqual(["none"]);
        expect(parseSpaceInput(privateInput({ dealPreferences: ["none", "fixed_fee"] })).ok).toBe(false);
        expect(parseSpaceInput(privateInput({ dealPreferences: [] })).ok).toBe(false);
        expect(parseSpaceInput(privateInput({ dealPreferences: ["cash"] })).ok).toBe(false);
    });

    test("step-free access uses the Accessibility tag's options", () => {
        for (const option of ["accessible", "stairs_involved", "not_specified"]) {
            expect(parseSpaceInput(privateInput({ stepFreeAccess: option })).ok).toBe(true);
        }
        expect(parseSpaceInput(privateInput({ stepFreeAccess: "yes" })).ok).toBe(false);
    });

    test("empty optional text is left out, not stored as an empty string", () => {
        const value = parsed(privateInput({ noiseCurfew: "  ", notesForPeerify: "" }));
        expect("noiseCurfew" in value).toBe(false);
        expect("notesForPeerify" in value).toBe(false);
    });

    test("a location is required", () => {
        expect(parseSpaceInput(privateInput({ location: { precision: 2, city: "Lund" } })).ok).toBe(false);
        expect(parseSpaceInput(popupInput({ location: undefined })).ok).toBe(false);
    });

    test("limits: name, capacity, notes", () => {
        expect(parseSpaceInput(popupInput({ name: "x".repeat(81) })).ok).toBe(false);
        expect(parseSpaceInput(popupInput({ name: "   " })).ok).toBe(false);
        expect(parseSpaceInput(popupInput({ capacity: 0 })).ok).toBe(false);
        expect(parseSpaceInput(popupInput({ capacity: 2.5 })).ok).toBe(false);
        expect(parseSpaceInput(privateInput({ notesForPeerify: "x".repeat(1001) })).ok).toBe(false);
    });
});

describe("owner scoping", () => {
    test("a space is listed only for its owner", async () => {
        await createSpaceForOwner(ALICE, parsed(privateInput()));
        expect(await listSpacesForOwner(ALICE)).toHaveLength(1);
        expect(await listSpacesForOwner(BOB)).toHaveLength(0);
        expect(stored()[0].ownerDid).toBe(ALICE);
    });

    test("another person can't change or delete it", async () => {
        const { id } = (await createSpaceForOwner(ALICE, parsed(privateInput()))) as { id: string };
        const before = JSON.stringify(stored());
        expect(await updateSpaceForOwner(BOB, id, parsed(privateInput({ capacity: 99 })))).toBe(false);
        expect(await deleteSpaceForOwner(BOB, id)).toBe(false);
        expect(JSON.stringify(stored())).toBe(before);
    });

    test("the owner can edit; emptied optional fields are removed; the checkbox dates stay", async () => {
        const { id } = (await createSpaceForOwner(ALICE, parsed(privateInput()))) as { id: string };
        const acceptedAt = stored()[0].listeningRuleAcceptedAt;
        expect(await updateSpaceForOwner(ALICE, id, parsed(privateInput({ capacity: 40, notesForPeerify: "" })))).toBe(true);
        const raw = stored()[0];
        expect(raw.capacity).toBe(40);
        expect("notesForPeerify" in raw).toBe(false);
        expect(raw.noiseCurfew).toBe("22:00");
        expect(raw.listeningRuleAcceptedAt).toBe(acceptedAt);
        expect("listeningRuleAccepted" in raw).toBe(false);
    });

    test("an edit can't change the type", async () => {
        const { id } = (await createSpaceForOwner(ALICE, parsed(privateInput()))) as { id: string };
        expect(await updateSpaceForOwner(ALICE, id, parsed(popupInput()))).toBe(false);
        expect(stored()[0].type).toBe("private");
    });

    test("the owner can delete", async () => {
        const { id } = (await createSpaceForOwner(ALICE, parsed(popupInput()))) as { id: string };
        await createSpaceForOwner(BOB, parsed(popupInput()));
        expect(await deleteSpaceForOwner(ALICE, id)).toBe(true);
        expect(stored().map((d) => d.ownerDid)).toEqual([BOB]);
    });

    test("an invalid id matches nothing", async () => {
        await createSpaceForOwner(ALICE, parsed(popupInput()));
        expect(await deleteSpaceForOwner(ALICE, "not-an-id")).toBe(false);
        expect(await updateSpaceForOwner(ALICE, "", parsed(popupInput()))).toBe(false);
        expect(stored()).toHaveLength(1);
    });

    test(`at most ${SPACES_PER_PERSON_MAX} spaces per person`, async () => {
        for (let i = 0; i < SPACES_PER_PERSON_MAX; i++) {
            expect((await createSpaceForOwner(ALICE, parsed(popupInput()))).ok).toBe(true);
        }
        expect(await createSpaceForOwner(ALICE, parsed(privateInput()))).toEqual({ ok: false, reason: "limit" });
        expect((await createSpaceForOwner(BOB, parsed(popupInput()))).ok).toBe(true);
        expect(stored()).toHaveLength(SPACES_PER_PERSON_MAX + 1);
    });
});

describe("getSpaceActor", () => {
    test("admin and verification come from the person's own user row", async () => {
        fakeDb.reset({
            Circles: [
                { did: ALICE, circleType: "user", isVerified: true },
                { did: BOB, circleType: "user" },
                { did: "did:test:admin", circleType: "user", isAdmin: true },
                { did: "did:test:artist", circleType: "circle", isAdmin: true },
            ],
        });
        expect(await getSpaceActor(ALICE)).toEqual({ did: ALICE, isAdmin: false, canCreate: true });
        expect(await getSpaceActor(BOB)).toEqual({ did: BOB, isAdmin: false, canCreate: false });
        expect(await getSpaceActor("did:test:admin")).toEqual({ did: "did:test:admin", isAdmin: true, canCreate: true });
        expect(await getSpaceActor("did:test:artist")).toBeNull();
        expect(await getSpaceActor(undefined)).toBeNull();
    });
});

describe("private space on the map (publiclyListed)", () => {
    const OFFSET = { bearingDeg: 123.45, distanceM: 300 };
    const metersBetween = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
        const dLat = (a.lat - b.lat) * 111_320;
        const dLng = (a.lng - b.lng) * 111_320 * Math.cos((b.lat * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLng * dLng);
    };
    const parsedFull = (raw: unknown) => {
        const result = parseSpaceInput(raw);
        if (!result.ok) throw new Error(result.error);
        return result;
    };
    const withOwner = (offerPinOffset?: unknown) =>
        fakeDb.reset({
            Circles: [{ _id: new ObjectId(), did: ALICE, circleType: "user", ...(offerPinOffset ? { offerPinOffset } : {}) }],
        });

    test("off by default; parse hands back the picked point only when listed", () => {
        const off = parsedFull(privateInput());
        expect(off.pickedLngLat).toBeUndefined();
        expect((off.value as any).publiclyListed).toBe(false);
        const on = parsedFull(privateInput({ publiclyListed: true }));
        expect(on.pickedLngLat).toEqual(EXACT.lngLat);
        // The value itself is still the rounded area: a caller that ignores pickedLngLat stores that.
        expect(on.value.location).toEqual(toAreaOnlyLocation(EXACT));
    });

    test("stores the point moved by the owner's offset, never the picked one", async () => {
        withOwner(OFFSET);
        const input = parsedFull(privateInput({ publiclyListed: true }));
        expect((await createSpaceForOwner(ALICE, input.value, input.pickedLngLat)).ok).toBe(true);
        const [doc] = stored();
        const raw = JSON.stringify(doc);
        expect(raw.includes(String(EXACT.lngLat.lng))).toBe(false);
        expect(raw.includes(String(EXACT.lngLat.lat))).toBe(false);
        expect(raw.includes("Drottninggatan")).toBe(false);
        expect(Math.abs(metersBetween(doc.location.lngLat, EXACT.lngLat) - 300) < 1).toBe(true);
        expect(doc.mapPinPlacedAt instanceof Date).toBe(true);
        expect(doc.publiclyListed).toBe(true);
    });

    test("a person without an offset gets one, and it's the one on their circle", async () => {
        withOwner();
        const input = parsedFull(privateInput({ publiclyListed: true }));
        await createSpaceForOwner(ALICE, input.value, input.pickedLngLat);
        const owner = fakeDb.col("Circles").docs[0];
        expect(owner.offerPinOffset.distanceM >= 200 && owner.offerPinOffset.distanceM <= 400).toBe(true);
        const d = metersBetween(stored()[0].location.lngLat, EXACT.lngLat);
        expect(Math.abs(d - owner.offerPinOffset.distanceM) < 1).toBe(true);
    });

    test("two spaces at the same place get the same pin (one offset per person)", async () => {
        withOwner(OFFSET);
        const input = parsedFull(privateInput({ publiclyListed: true }));
        await createSpaceForOwner(ALICE, input.value, input.pickedLngLat);
        await createSpaceForOwner(ALICE, input.value, input.pickedLngLat);
        expect(stored()[0].location.lngLat).toEqual(stored()[1].location.lngLat);
    });

    test("an edit that sends the stored pin back keeps it; picking again moves it", async () => {
        withOwner(OFFSET);
        const input = parsedFull(privateInput({ publiclyListed: true }));
        const { id } = (await createSpaceForOwner(ALICE, input.value, input.pickedLngLat)) as { ok: true; id: string };
        const pin = { ...stored()[0].location.lngLat };
        const placedAt = stored()[0].mapPinPlacedAt;

        const sameAgain = parsedFull(privateInput({ publiclyListed: true, location: { ...EXACT, lngLat: pin }, capacity: 30 }));
        expect(await updateSpaceForOwner(ALICE, id, sameAgain.value, sameAgain.pickedLngLat)).toBe(true);
        expect(stored()[0].location.lngLat).toEqual(pin);
        expect(stored()[0].mapPinPlacedAt).toEqual(placedAt);
        expect(stored()[0].capacity).toBe(30);

        const elsewhere = { lng: 18.07, lat: 59.34 };
        const moved = parsedFull(privateInput({ publiclyListed: true, location: { ...EXACT, lngLat: elsewhere } }));
        await updateSpaceForOwner(ALICE, id, moved.value, moved.pickedLngLat);
        expect(Math.abs(metersBetween(stored()[0].location.lngLat, elsewhere) - 300) < 1).toBe(true);
    });

    test("a space saved with its rounded area stays off the map until the place is picked", async () => {
        withOwner(OFFSET);
        const { id } = (await createSpaceForOwner(ALICE, parsed(privateInput()))) as { ok: true; id: string };
        const area = { ...stored()[0].location.lngLat };
        const optIn = parsedFull(privateInput({ publiclyListed: true, location: { ...EXACT, lngLat: area } }));
        await updateSpaceForOwner(ALICE, id, optIn.value, optIn.pickedLngLat);
        expect(stored()[0].location.lngLat).toEqual(area);
        expect(stored()[0].mapPinPlacedAt).toBeUndefined();
    });

    test("turning it off rounds the point again and drops the pin date", async () => {
        withOwner(OFFSET);
        const input = parsedFull(privateInput({ publiclyListed: true }));
        const { id } = (await createSpaceForOwner(ALICE, input.value, input.pickedLngLat)) as { ok: true; id: string };
        const pin = stored()[0].location.lngLat;
        const off = parsedFull(privateInput({ publiclyListed: false, location: { ...EXACT, lngLat: pin } }));
        await updateSpaceForOwner(ALICE, id, off.value, off.pickedLngLat);
        expect(stored()[0].location.lngLat).toEqual(coarsenLngLat(pin, 0.1));
        expect("mapPinPlacedAt" in stored()[0]).toBe(false);
        expect(stored()[0].publiclyListed).toBe(false);
    });

    test("an invalid stored offset keeps the space off the map", async () => {
        withOwner({ bearingDeg: 10, distanceM: 5 });
        const input = parsedFull(privateInput({ publiclyListed: true }));
        await createSpaceForOwner(ALICE, input.value, input.pickedLngLat);
        expect(stored()[0].location).toEqual(toAreaOnlyLocation(EXACT));
        expect(stored()[0].mapPinPlacedAt).toBeUndefined();
    });
});
