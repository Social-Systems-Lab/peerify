import assert from "node:assert/strict";
import {
    classifyLocationInput,
    eventNeedsLocation,
    parseUsableLocationInput,
    toUsableLocation,
} from "./event-location";

// Run: bun src/lib/utils/event-location.test.ts — pure, no database.
// Profiles saved without a map location hold {}; that must read as "no location", not fail.

assert.equal(toUsableLocation({}), undefined);
assert.equal(toUsableLocation(null), undefined);
assert.equal(toUsableLocation({ precision: 2 }), undefined);
assert.equal(toUsableLocation({ city: "Oslo" }), undefined); // no precision: not the stored shape
assert.deepEqual(toUsableLocation({ precision: 2, city: "Oslo", country: "Norway" }), {
    precision: 2,
    city: "Oslo",
    country: "Norway",
});
assert.ok(toUsableLocation({ precision: 4, lngLat: { lng: 10.7, lat: 59.9 } }));

assert.equal(parseUsableLocationInput("{}"), undefined);
assert.equal(parseUsableLocationInput("not json"), undefined);
assert.equal(parseUsableLocationInput(undefined), undefined);
assert.ok(parseUsableLocationInput(JSON.stringify({ precision: 1, region: "Skåne" })));

assert.equal(eventNeedsLocation(true, false), false); // virtual
assert.equal(eventNeedsLocation(true, true), true); // hybrid
assert.equal(eventNeedsLocation(false, false), true); // physical
assert.equal(eventNeedsLocation(undefined, undefined), true);

// saveAbout: {} from an untouched form is ignored; the picker's Clear ({ precision }) or null clears.
assert.equal(classifyLocationInput({}), "untouched");
assert.equal(classifyLocationInput(undefined), "untouched");
assert.equal(classifyLocationInput({ precision: 2 }), "cleared");
assert.equal(classifyLocationInput(null), "cleared");
assert.equal(classifyLocationInput({ precision: 2, city: "Oslo" }), "set");

console.log("event-location: all tests passed");
