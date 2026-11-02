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
const {
    canViewSpacePhoto,
    createSpaceForOwner,
    getSpacePhotosForOwner,
    deleteSpaceForOwner,
    getSpaceActor,
    getSpaceDetailsForMember,
    getSpaceMapPins,
    listAllSpacesForAdmin,
    listSpacesForOwner,
    updateSpaceForOwner,
    SPACES_PER_PERSON_MAX,
} = await import("./space");

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

describe("space map pins and details (getSpaceMapPins, getSpaceDetailsForMember)", () => {
    const OFFSET = { bearingDeg: 200, distanceM: 250 };
    const owners = (extra: Record<string, unknown>[] = []) =>
        fakeDb.reset({
            Circles: [
                { _id: new ObjectId(), did: ALICE, circleType: "user", name: "Alice", handle: "alice", offerPinOffset: OFFSET },
                { _id: new ObjectId(), did: BOB, circleType: "user", offerPinOffset: OFFSET, publishStatus: "draft" },
                ...extra,
            ],
        });
    const listed = (did: string, overrides: Record<string, unknown> = {}) => {
        const result = parseSpaceInput(privateInput({ publiclyListed: true, ...overrides }));
        if (!result.ok) throw new Error(result.error);
        return createSpaceForOwner(did, result.value, result.pickedLngLat) as Promise<{ ok: true; id: string }>;
    };

    test("only listed private spaces with a pin, of published owners", async () => {
        owners();
        const { id } = await listed(ALICE);
        await createSpaceForOwner(ALICE, parsed(privateInput()));
        await createSpaceForOwner(ALICE, parsed(popupInput()));
        await listed(BOB);
        const pins = await getSpaceMapPins();
        expect(pins.map((pin) => pin._id)).toEqual([id]);
    });

    test("a pin carries the space id, area names and the moved point, nothing else", async () => {
        owners();
        const { id } = await listed(ALICE);
        const [pin] = await getSpaceMapPins();
        expect(Object.keys(pin).sort()).toEqual(["_id", "location", "spaceKind"]);
        expect(Object.keys(pin.location).sort()).toEqual(["city", "country", "countryCode", "lngLat", "precision", "region"]);
        expect(pin.location.lngLat).toEqual(stored()[0].location.lngLat);
        const raw = JSON.stringify(pin);
        for (const hidden of [ALICE, "alice", "Alice", "Ring the bell", "Drottninggatan", String(EXACT.lngLat.lng)]) {
            expect(raw.includes(hidden)).toBe(false);
        }
        expect(pin._id).toBe(id);
    });

    test("details: the allow-listed fields only, and only for a space on the map", async () => {
        owners();
        const { id } = await listed(ALICE);
        const details = await getSpaceDetailsForMember(id);
        expect(details).toEqual({
            _id: id,
            spaceKind: "private",
            capacity: 25,
            setting: ["indoor"],
            amplification: "acoustic_only",
            noiseCurfew: "22:00",
            stepFreeAccess: "stairs_involved",
            dealPreferences: ["takings_share", "food_drinks"],
            photos: [],
        });
        expect(JSON.stringify(details).includes("Ring the bell")).toBe(false);

        const hidden = (await createSpaceForOwner(ALICE, parsed(privateInput()))) as { ok: true; id: string };
        expect(await getSpaceDetailsForMember(hidden.id)).toBeNull();
        const draftOwner = await listed(BOB);
        expect(await getSpaceDetailsForMember(draftOwner.id)).toBeNull();
        expect(await getSpaceDetailsForMember("not-an-id")).toBeNull();
    });
});

describe("space photos (canViewSpacePhoto, stored photos)", () => {
    const OFFSET = { bearingDeg: 45, distanceM: 350 };
    const ADMIN = "did:test:admin";
    const CAROL = "did:test:carol";
    const photo = (spaceId: string, n: number) => ({
        url: `/api/space-photo/${spaceId}/0123456789abcdef0123456789abcde${n}.jpg`,
        fileName: `0123456789abcdef0123456789abcde${n}.jpg`,
        originalName: `garden${n}.jpg`,
    });
    const people = () =>
        fakeDb.reset({
            Circles: [
                { _id: new ObjectId(), did: ALICE, circleType: "user", offerPinOffset: OFFSET },
                { _id: new ObjectId(), did: CAROL, circleType: "user" },
                { _id: new ObjectId(), did: ADMIN, circleType: "user", isAdmin: true },
            ],
        });
    const create = async (listed: boolean) => {
        const result = parseSpaceInput(privateInput({ publiclyListed: listed }));
        if (!result.ok) throw new Error(result.error);
        const spaceId = String(new ObjectId());
        const photos = [photo(spaceId, 1), photo(spaceId, 2)];
        const created = await createSpaceForOwner(ALICE, result.value, result.pickedLngLat, { spaceId, photos });
        return { spaceId, photos, created };
    };

    test("create stores the photos under the chosen id", async () => {
        people();
        const { spaceId, photos, created } = await create(true);
        expect(created).toEqual({ ok: true, id: spaceId });
        expect(String(stored()[0]._id)).toBe(spaceId);
        expect(stored()[0].photos).toEqual(photos);
        expect(await getSpacePhotosForOwner(ALICE, spaceId)).toEqual(photos);
        expect(await getSpacePhotosForOwner(BOB, spaceId)).toBeNull();
    });

    test("on the map: owner, admin and any signed-in person; never signed out or a photo it lacks", async () => {
        people();
        const { spaceId, photos } = await create(true);
        expect(await canViewSpacePhoto(ALICE, spaceId, photos[0].url)).toBe(true);
        expect(await canViewSpacePhoto(ADMIN, spaceId, photos[0].url)).toBe(true);
        expect(await canViewSpacePhoto(CAROL, spaceId, photos[1].url)).toBe(true);
        expect(await canViewSpacePhoto(undefined, spaceId, photos[0].url)).toBe(false);
        expect(await canViewSpacePhoto(CAROL, spaceId, photo(spaceId, 3).url)).toBe(false);
        expect(await canViewSpacePhoto("did:test:nobody", spaceId, photos[0].url)).toBe(false);
    });

    test("off the map: only the owner and admins", async () => {
        people();
        const { spaceId, photos } = await create(false);
        expect(await canViewSpacePhoto(ALICE, spaceId, photos[0].url)).toBe(true);
        expect(await canViewSpacePhoto(ADMIN, spaceId, photos[0].url)).toBe(true);
        expect(await canViewSpacePhoto(CAROL, spaceId, photos[0].url)).toBe(false);
    });

    test("details carry the photo addresses; an update with no photos removes them", async () => {
        people();
        const { spaceId, photos } = await create(true);
        expect((await getSpaceDetailsForMember(spaceId))!.photos).toEqual(
            photos.map((p) => ({ url: p.url, originalName: p.originalName })),
        );
        const again = parseSpaceInput(privateInput({ publiclyListed: true, location: { ...EXACT, lngLat: stored()[0].location.lngLat } }));
        if (!again.ok) throw new Error(again.error);
        await updateSpaceForOwner(ALICE, spaceId, again.value, again.pickedLngLat, [photos[1]]);
        expect(stored()[0].photos).toEqual([photos[1]]);
        await updateSpaceForOwner(ALICE, spaceId, again.value, again.pickedLngLat, []);
        expect("photos" in stored()[0]).toBe(false);
    });
});

describe("pop-up on the map (publiclyListed, pinAtExactAddress, showNameOnMap)", () => {
    const OWNER_OFFSET = { bearingDeg: 10, distanceM: 210 };
    const metersBetween = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
        const dLat = (a.lat - b.lat) * 111_320;
        const dLng = (a.lng - b.lng) * 111_320 * Math.cos((b.lat * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLng * dLng);
    };
    const withOwner = () =>
        fakeDb.reset({
            Circles: [{ _id: new ObjectId(), did: ALICE, circleType: "user", name: "Alice", handle: "alice", offerPinOffset: OWNER_OFFSET }],
        });
    const create = async (overrides: Record<string, unknown> = {}) =>
        ((await createSpaceForOwner(ALICE, parsed(popupInput(overrides)))) as { ok: true; id: string }).id;
    const edit = (id: string, overrides: Record<string, unknown> = {}) =>
        updateSpaceForOwner(ALICE, id, parsed(popupInput(overrides)));
    const rawDoc = (id: string) => stored().find((doc) => String(doc._id) === id)!;

    test("parse: off by default; the name is only kept with the exact address", () => {
        const off = parsed(popupInput()) as any;
        expect([off.publiclyListed, off.pinAtExactAddress, off.showNameOnMap]).toEqual([false, false, false]);
        const near = parsed(popupInput({ publiclyListed: true, showNameOnMap: true })) as any;
        expect(near.showNameOnMap).toBe(false);
        const exact = parsed(popupInput({ publiclyListed: true, pinAtExactAddress: true, showNameOnMap: true })) as any;
        expect(exact.showNameOnMap).toBe(true);
    });

    test("off the map: no pin, no details, no offset", async () => {
        withOwner();
        const id = await create();
        expect(await getSpaceMapPins()).toEqual([]);
        expect(await getSpaceDetailsForMember(id)).toBeNull();
        expect(rawDoc(id).pinOffset).toBeUndefined();
    });

    test("near: the exact point stays stored, the pin is moved 200–400 m by the space's own offset", async () => {
        withOwner();
        const id = await create({ publiclyListed: true });
        const doc = rawDoc(id);
        expect(doc.location.lngLat).toEqual(EXACT.lngLat);
        expect(doc.location.street).toBe(EXACT.street);
        expect(typeof doc.pinOffset?.distanceM).toBe("number");
        // Its own offset, not the owner's (see the Spaces comment in models.ts).
        expect(doc.pinOffset).not.toEqual(OWNER_OFFSET);

        const [pin] = await getSpaceMapPins();
        expect(Object.keys(pin).sort()).toEqual(["_id", "location", "spaceKind"]);
        expect(pin.spaceKind).toBe("popup");
        const meters = metersBetween(pin.location.lngLat!, EXACT.lngLat);
        expect(meters >= 199 && meters <= 401).toBe(true);
        const raw = JSON.stringify(pin);
        for (const hidden of [ALICE, "alice", "Kafé Lyssna", "Drottninggatan", String(EXACT.lngLat.lng), "bearingDeg"]) {
            expect(raw.includes(hidden)).toBe(false);
        }
    });

    test("an edit keeps the pin where it is; going exact drops the offset; back to near makes a new one", async () => {
        withOwner();
        const id = await create({ publiclyListed: true });
        const first = rawDoc(id).pinOffset;
        const [before] = await getSpaceMapPins();
        await edit(id, { publiclyListed: true, capacity: 80 });
        expect(rawDoc(id).pinOffset).toEqual(first);
        expect((await getSpaceMapPins())[0].location.lngLat).toEqual(before.location.lngLat);

        await edit(id, { publiclyListed: true, pinAtExactAddress: true });
        expect(rawDoc(id).pinOffset).toBeUndefined();
        await edit(id, { publiclyListed: true });
        const second = rawDoc(id).pinOffset;
        expect(typeof second?.distanceM).toBe("number");
        expect(second).not.toEqual(first);
    });

    test("turning it off keeps the offset (nothing was shown), and the pin goes", async () => {
        withOwner();
        const id = await create({ publiclyListed: true });
        const offset = rawDoc(id).pinOffset;
        await edit(id);
        expect(rawDoc(id).pinOffset).toEqual(offset);
        expect(await getSpaceMapPins()).toEqual([]);
    });

    test("exact: the pin is at the point; the name only when the owner shows it", async () => {
        withOwner();
        const id = await create({ publiclyListed: true, pinAtExactAddress: true });
        const [pin] = await getSpaceMapPins();
        expect(pin.location.lngLat).toEqual(EXACT.lngLat);
        expect(pin.atExactAddress).toBe(true);
        expect(pin.name).toBeUndefined();
        expect(JSON.stringify(pin).includes("Drottninggatan")).toBe(false);
        expect("name" in ((await getSpaceDetailsForMember(id)) ?? {})).toBe(false);

        await edit(id, { publiclyListed: true, pinAtExactAddress: true, showNameOnMap: true });
        expect((await getSpaceMapPins())[0].name).toBe("Kafé Lyssna");
        expect(((await getSpaceDetailsForMember(id)) as any).name).toBe("Kafé Lyssna");
    });

    test("details: the pop-up's allow-listed fields", async () => {
        withOwner();
        const id = await create({ publiclyListed: true });
        expect(await getSpaceDetailsForMember(id)).toEqual({
            _id: id,
            spaceKind: "popup",
            capacity: 60,
            dealPreferences: ["fixed_fee"],
            showTimes: "Sunday evenings after closing",
            noiseLimits: "Quiet after 23:00",
            powerAvailable: true,
            paAvailable: false,
            photos: [],
        });
    });

    test("a moved pin with no valid offset gets no pin, never one at the real point", async () => {
        withOwner();
        const id = await create({ publiclyListed: true });
        rawDoc(id).pinOffset = { bearingDeg: 0, distanceM: 5 };
        expect(await getSpaceMapPins()).toEqual([]);
        expect(await getSpaceDetailsForMember(id)).toBeNull();
    });

    test("the offset never reaches the owner's or the admin's view", async () => {
        withOwner();
        await create({ publiclyListed: true });
        expect(JSON.stringify(await listSpacesForOwner(ALICE)).includes("bearingDeg")).toBe(false);
        expect(JSON.stringify(await listAllSpacesForAdmin()).includes("bearingDeg")).toBe(false);
    });
});
