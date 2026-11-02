import assert from "node:assert/strict";
import type { Circle, Location } from "@/models/models";
import {
    OFFER_PIN_OFFSET_MAX_METERS,
    OFFER_PIN_OFFSET_MIN_METERS,
    PUBLIC_COARSE_PIN_GRID_DEGREES,
    getOfferPinLocation,
    redactCircleLocationForViewer,
    redactLocationForViewer,
} from "../utils";
import { toPublicCircle, toPublicCircleListItem, toPublicLocation, toPublicMetadata } from "./public-circle";

// Run: bun src/lib/utils/public-location.test.ts — pure, no database.
// A precision-4 location WITHOUT exactConfirmedAt must never reach a public surface with its
// street or exact coordinates: profile pages, Explore/search/directory lists, member lists,
// the feed (redactCircleLocationForViewer + toPublicLocation), and Offers map pins.

const STREET = "Keizersgracht 123";
const EXACT = { lng: 4.883421, lat: 52.370512 };
const exactLocation = (confirmed: boolean): Location => ({
    precision: 4,
    country: "Netherlands",
    countryCode: "NL",
    region: "North Holland",
    city: "Amsterdam",
    street: STREET,
    lngLat: { ...EXACT },
    ...(confirmed ? { exactConfirmedAt: new Date("2026-10-08T10:00:00Z") } : {}),
});

const OWNER = "did:qa:owner";
const STRANGER = "did:qa:stranger";
const circleOf = (identityType: string | undefined, circleType: "user" | "circle", confirmed: boolean, addressVisibility?: string) =>
    ({
        _id: "665f00000000000000000001",
        did: OWNER,
        handle: "qa",
        name: "QA",
        circleType,
        location: exactLocation(confirmed),
        metadata: identityType
            ? {
                  peerify: {
                      identityType,
                      managedIdentity: identityType === "venue" ? true : undefined,
                      ...(identityType === "venue" ? { venueProfile: { addressVisibility } } : {}),
                  },
              }
            : undefined,
    }) as unknown as Circle;

const CASES: [string, Circle][] = [
    ["user profile", circleOf(undefined, "user", false)],
    ["artist", circleOf("artist", "circle", false)],
    ["band", circleOf("band", "circle", false)],
    ["plain circle", circleOf(undefined, "circle", false)],
    ["venue, address public", circleOf("venue", "circle", false, "public")],
    ["venue, address private", circleOf("venue", "circle", false, "private")],
];

const isOnGrid = (n: number) => {
    const steps = n / PUBLIC_COARSE_PIN_GRID_DEGREES;
    return Math.abs(steps - Math.round(steps)) < 1e-6;
};
const assertNotExact = (label: string, output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    assert.equal(text.includes(STREET), false, `${label}: street leaked`);
    assert.equal(text.includes(String(EXACT.lng)), false, `${label}: exact longitude leaked`);
    assert.equal(text.includes(String(EXACT.lat)), false, `${label}: exact latitude leaked`);
    assert.equal(text.includes("exactConfirmedAt"), false, `${label}: opt-in marker leaked`);
    const lngLat = (output as { location?: Location; lngLat?: Location["lngLat"] })?.location?.lngLat ??
        (output as Location | undefined)?.lngLat;
    if (lngLat) {
        assert.ok(isOnGrid(lngLat.lng) && isOnGrid(lngLat.lat), `${label}: pin not on the ~5 km grid`);
    }
};

const viewers = [
    ["logged out", { viewerDid: undefined }],
    ["logged in, not owner", { viewerDid: STRANGER }],
] as const;

for (const [name, circle] of CASES) {
    for (const [who, { viewerDid }] of viewers) {
        const label = `${name} / ${who}`;
        const viewer = { viewerDid, viewerIsAdmin: false };
        assertNotExact(`${label} / redactCircleLocationForViewer`, redactCircleLocationForViewer(circle, viewer));
        assertNotExact(`${label} / redactLocationForViewer`, redactLocationForViewer(circle.location, circle.did, viewer));
        assertNotExact(`${label} / feed + member lists`, toPublicLocation(redactCircleLocationForViewer(circle, viewer)));
        assertNotExact(
            `${label} / profile page`,
            toPublicCircle(circle, { viewerDid, viewerIsPlatformAdmin: false, viewerCanManage: false }),
        );
        assertNotExact(`${label} / list item`, toPublicCircleListItem(circle, { viewerDid, viewerIsPlatformAdmin: false }));
    }
    assertNotExact(`${name} / offers pin`, getOfferPinLocation(circle));
}

// Unconfirmed exact still gets a pin on lists and the Offers map (unless the venue ceiling hides it).
const artistItem = toPublicCircleListItem(CASES[1][1], { viewerDid: undefined, viewerIsPlatformAdmin: false });
assert.equal(artistItem.location?.precision, 2);
assert.equal(artistItem.location?.city, "Amsterdam");
assert.deepEqual(artistItem.location?.lngLat, { lng: 4.9, lat: 52.35 });
assert.deepEqual(getOfferPinLocation(CASES[1][1])?.lngLat, { lng: 4.9, lat: 52.35 });

// Confirmed exact is shown exactly (venue only when its address is public too).
const confirmedArtist = circleOf("artist", "circle", true);
const shown = toPublicCircleListItem(confirmedArtist, { viewerDid: undefined, viewerIsPlatformAdmin: false });
assert.equal(shown.location?.street, STREET);
assert.deepEqual(shown.location?.lngLat, EXACT);
assert.deepEqual(getOfferPinLocation(confirmedArtist)?.lngLat, EXACT);
assertNotExact(
    "confirmed venue, address private / list item",
    toPublicCircleListItem(circleOf("venue", "circle", true, "private"), { viewerDid: undefined, viewerIsPlatformAdmin: false }),
);
// Offers map: a venue's confirmed "exact" only counts when its address is public, the same ceiling
// as its profile pin. No addressVisibility stored means the default, "private".
for (const visibility of ["private", "city_area", undefined]) {
    const venue = circleOf("venue", "circle", true, visibility);
    assertNotExact(`confirmed venue, address ${visibility ?? "unset"} / offers pin`, getOfferPinLocation(venue));
    assert.ok(
        getOfferPinLocation(venue)?.lngLat,
        `confirmed venue, address ${visibility ?? "unset"}: still gets a grid pin`,
    );
}
assert.deepEqual(getOfferPinLocation(circleOf("venue", "circle", true, "public"))?.lngLat, EXACT);
assert.equal(getOfferPinLocation(circleOf("venue", "circle", true, "public"))?.street, STREET);

// No coordinates: still no street (it used to come back unchanged).
const streetOnly = {
    ...circleOf(undefined, "user", false),
    location: { ...exactLocation(false), precision: 3, lngLat: undefined },
};
assertNotExact("street-level location without lngLat / offers pin", getOfferPinLocation(streetOnly as Circle));

// Profile pages never show street/pin, confirmed or not.
assertNotExact(
    "confirmed artist / profile page",
    toPublicCircle(confirmedArtist, { viewerDid: undefined, viewerIsPlatformAdmin: false, viewerCanManage: false }),
);

// Owner and platform admins keep the full location.
const unconfirmed = CASES[1][1];
assert.equal(toPublicCircleListItem(unconfirmed, { viewerDid: OWNER, viewerIsPlatformAdmin: false }).location?.street, STREET);
assert.equal(toPublicCircleListItem(unconfirmed, { viewerDid: STRANGER, viewerIsPlatformAdmin: true }).location?.street, STREET);

// Metadata: internal fields never; contact/booking details for logged-in viewers only.
const metadata = {
    onboardingFlow: "x",
    signupIntent: "x",
    authProviders: { vibeId: { profile: { email: "a@example.invalid" } } },
    peerify: {
        identityType: "venue",
        managedIdentity: true,
        autoProvisionedFromSignup: true,
        artistProfile: {
            baseCity: "Utrecht",
            bookingEnabled: true,
            bookingSettings: { baseFee: 100, notes: "n", technicalNeeds: "t" },
            availability: "x",
        },
        venueProfile: {
            address: "a",
            publicCity: "c",
            contactEmail: "v@example.invalid",
            phone: "0612345678",
            bookingNote: "b",
            accessibilityNotes: "ramp",
            capacityStanding: 80,
        },
    },
} as unknown as Circle["metadata"];
const anon = JSON.stringify(toPublicMetadata(metadata, false));
for (const key of ["onboardingFlow", "signupIntent", "authProviders", "autoProvisionedFromSignup", "availability", '"notes"', '"address"', "publicCity", "contactEmail", "phone", "bookingNote", "technicalNeeds"]) {
    assert.equal(anon.includes(key), false, `logged out: ${key} must not be sent`);
}
for (const key of ["baseCity", "accessibilityNotes", "capacityStanding", "baseFee"]) {
    assert.equal(anon.includes(key), true, `logged out: ${key} should be public`);
}
const loggedIn = JSON.stringify(toPublicMetadata(metadata, true));
for (const key of ["contactEmail", "phone", "bookingNote", "technicalNeeds"]) {
    assert.equal(loggedIn.includes(key), true, `logged in: ${key} should be sent`);
}
for (const key of ["onboardingFlow", "signupIntent", "authProviders", "autoProvisionedFromSignup", '"address"', "publicCity", '"notes"']) {
    assert.equal(loggedIn.includes(key), false, `logged in: ${key} must not be sent`);
}

// Offers map: a stored offerPinOffset moves the pin 200–400 m from the real point, the same way
// on every call; a missing or out-of-range offset falls back to the grid, never the real point.
const metersBetween = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};
for (const offset of [
    { bearingDeg: 12.5, distanceM: OFFER_PIN_OFFSET_MIN_METERS },
    { bearingDeg: 101, distanceM: OFFER_PIN_OFFSET_MAX_METERS },
    { bearingDeg: 217.5, distanceM: 300 },
]) {
    const withOffset = { ...CASES[1][1], offerPinOffset: offset } as Circle;
    const pin = getOfferPinLocation(withOffset);
    const text = JSON.stringify(pin);
    for (const leak of [STREET, String(EXACT.lng), String(EXACT.lat), "exactConfirmedAt"]) {
        assert.equal(text.includes(leak), false, `offset ${offset.distanceM} m / offers pin: ${leak} leaked`);
    }
    const distance = metersBetween(EXACT, pin!.lngLat!);
    assert.ok(Math.abs(distance - offset.distanceM) < 2, `offset ${offset.distanceM} m: pin is ${distance.toFixed(1)} m away`);
    assert.deepEqual(getOfferPinLocation(withOffset)?.lngLat, pin?.lngLat, "same offset, same pin");
    assert.equal(pin?.precision, 2);
}
for (const bad of [{ bearingDeg: 10, distanceM: 50 }, { bearingDeg: 10, distanceM: 5000 }, { bearingDeg: Number.NaN, distanceM: 300 }]) {
    const pin = getOfferPinLocation({ ...CASES[1][1], offerPinOffset: bad } as Circle);
    assert.deepEqual(pin?.lngLat, { lng: 4.9, lat: 52.35 }, `invalid offset ${JSON.stringify(bad)}: grid pin`);
}
// The offset never leaves the server through the public shapes: offset plus pin is the address.
const withStoredOffset = { ...CASES[1][1], offerPinOffset: { bearingDeg: 45, distanceM: 250 } } as Circle;
for (const [name, shape] of [
    ["profile page", toPublicCircle(withStoredOffset, { viewerDid: undefined, viewerIsPlatformAdmin: false, viewerCanManage: false })],
    ["profile page, signed in", toPublicCircle(withStoredOffset, { viewerDid: STRANGER, viewerIsPlatformAdmin: false, viewerCanManage: false })],
    ["list item", toPublicCircleListItem(withStoredOffset, { viewerDid: undefined, viewerIsPlatformAdmin: false })],
    ["offers pin", getOfferPinLocation(withStoredOffset)],
] as const) {
    assert.equal(JSON.stringify(shape).includes("offerPinOffset"), false, `${name}: offerPinOffset must not be sent`);
}

// Retired offer types (Show space) reach the owner's own profile only.
const withShowSpace = {
    ...CASES[1][1],
    tourTeamOfferings: [
        { id: "show-1", type: "hosting_show" },
        { id: "meal-1", type: "home_cooked_meal" },
    ],
} as Circle;
for (const viewerDid of [undefined, STRANGER]) {
    const shaped = toPublicCircle(
        withShowSpace,
        { viewerDid, viewerIsPlatformAdmin: false, viewerCanManage: false },
        { includeTourTeamOfferings: true },
    );
    assert.deepEqual(
        shaped.tourTeamOfferings?.map((offering) => offering.type),
        ["home_cooked_meal"],
        `${viewerDid ?? "logged out"}: Show space hidden`,
    );
}
assert.equal(
    toPublicCircle(withShowSpace, { viewerDid: OWNER, viewerIsPlatformAdmin: false, viewerCanManage: false }, { includeTourTeamOfferings: true })
        .tourTeamOfferings?.length,
    2,
    "owner keeps their Show space",
);

console.log("public-location: all tests passed");
