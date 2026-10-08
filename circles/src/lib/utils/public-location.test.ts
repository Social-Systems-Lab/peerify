import assert from "node:assert/strict";
import type { Circle, Location } from "@/models/models";
import {
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
    assertNotExact(`${name} / offers pin`, getOfferPinLocation(circle.location));
}

// Unconfirmed exact still gets a pin on lists and the Offers map (unless the venue ceiling hides it).
const artistItem = toPublicCircleListItem(CASES[1][1], { viewerDid: undefined, viewerIsPlatformAdmin: false });
assert.equal(artistItem.location?.precision, 2);
assert.equal(artistItem.location?.city, "Amsterdam");
assert.deepEqual(artistItem.location?.lngLat, { lng: 4.9, lat: 52.35 });
assert.deepEqual(getOfferPinLocation(CASES[1][1].location)?.lngLat, { lng: 4.9, lat: 52.35 });

// Confirmed exact is shown exactly (venue only when its address is public too).
const confirmedArtist = circleOf("artist", "circle", true);
const shown = toPublicCircleListItem(confirmedArtist, { viewerDid: undefined, viewerIsPlatformAdmin: false });
assert.equal(shown.location?.street, STREET);
assert.deepEqual(shown.location?.lngLat, EXACT);
assert.deepEqual(getOfferPinLocation(confirmedArtist.location)?.lngLat, EXACT);
assertNotExact(
    "confirmed venue, address private / list item",
    toPublicCircleListItem(circleOf("venue", "circle", true, "private"), { viewerDid: undefined, viewerIsPlatformAdmin: false }),
);
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

console.log("public-location: all tests passed");
