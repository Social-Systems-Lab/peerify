// Run: IS_BUILD=true bun test src/components/modules/events/event-form-location-loop.test.tsx
// Create → Event crashed with "Maximum update depth exceeded" (React #185) when the host circle's
// saved location carried exactConfirmedAt (Tim, 2026-11-24, staging as Hello Peer): the form
// prefills the event location from the circle, the LocationPicker's precision effect called
// onChange on every render (an event location isn't a profile location, so it always wanted the
// opt-in stamp gone), and onChange was a new function on every render. Mounts the real EventForm
// in jsdom with the circle picker stubbed to hand over a circle with each stored location shape.
// The database is in-memory fakes; mapbox-gl is a stub (no key is set, so no map is created).

import { describe, expect, mock, test } from "bun:test";
// @ts-ignore jsdom ships no type declarations (it comes in with isomorphic-dompurify)
import { JSDOM } from "jsdom";
import React from "react";
import { createFakeDb } from "@/lib/testing/fake-db";

// A browser-like global environment for react-dom/client.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://staging.test/circles/hello-peer/home",
    pretendToBeVisual: true,
});
const g = globalThis as any;
for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in g)) {
        try {
            g[key] = (dom.window as any)[key];
        } catch {
            // some window getters throw outside a document; not needed here
        }
    }
}
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
g.IS_REACT_ACT_ENVIRONMENT = true;

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/circles/hello-peer/home",
    useSearchParams: () => new URLSearchParams(),
}));
mock.module("mapbox-gl", () => ({
    default: { Map: class {}, Marker: class {}, accessToken: "" },
}));
mock.module("@/components/modules/events/event-artist-picker", () => ({ default: () => null }));

// The circle the picker hands to the form, as the real CircleSelector does once it has loaded
// the viewer's selectable circles.
let pickedCircle: any = null;
function StubCircleSelector({ onCircleSelected }: { onCircleSelected: (c: any) => void }) {
    React.useEffect(() => {
        onCircleSelected(pickedCircle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}
mock.module("@/components/global-create/circle-selector", () => ({ default: StubCircleSelector }));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { createStore, Provider } = await import("jotai");
const { userAtom } = await import("@/lib/data/atoms");
const { default: EventForm } = await import("./event-form");
const { default: LocationPicker } = await import("@/components/forms/location-picker");

const LNG_LAT = { lng: 18.4241, lat: -33.9249 };
const circleWith = (location: unknown) => ({
    _id: "650000000000000000000051",
    did: "did:test:hello-peer",
    handle: "hello-peer",
    name: "Hello Peer",
    circleType: "user",
    location,
});

// A loop through useEffect makes React warn rather than throw, and act() would then never return.
// Past this many renders the component throws, so a loop fails the test instead of hanging it.
const RENDER_CAP = 200;
let renders = 0;
let pickerParentRenders = 0;
const realLog = console.log;
const realError = console.error;
let errors: string[] = [];
console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("EventForm mounted/updated")) {
        renders += 1;
        if (renders > RENDER_CAP) throw new Error("Maximum update depth (test render cap)");
        return;
    }
    realLog(...args);
};

// Mounts a tree, lets effects settle, and reports renders and any update-depth error.
const mount = async (element: React.ReactElement) => {
    renders = 0;
    pickerParentRenders = 0;
    errors = [];
    console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container, {
        onUncaughtError: (error: unknown) => errors.push(String(error)),
        onCaughtError: (error: unknown) => errors.push(String(error)),
    } as any);
    let thrown: unknown;
    try {
        await act(async () => {
            root.render(element);
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    } catch (error) {
        thrown = error;
    }
    const html = container.innerHTML;
    await act(async () => root.unmount());
    container.remove();
    console.error = realError;
    const depthError = [String(thrown ?? ""), ...errors].some((text) =>
        /Maximum update depth|Minified React error #185/.test(text),
    );
    return { renders, depthError, html };
};

const openCreateEvent = (location: unknown) => {
    pickedCircle = circleWith(location);
    const store = createStore();
    store.set(userAtom, {
        _id: pickedCircle._id,
        did: pickedCircle.did,
        handle: "hello-peer",
        isVerified: true,
    } as any);
    return (
        <Provider store={store}>
            <EventForm showCirclePicker />
        </Provider>
    );
};

describe("Create → Event, with the host circle's stored location", () => {
    test("exactConfirmedAt set (the owner showed their exact location): no render loop", async () => {
        const result = await mount(
            openCreateEvent({
                precision: 4,
                city: "Cape Town",
                lngLat: LNG_LAT,
                exactConfirmedAt: new Date("2026-10-01"),
            }),
        );
        expect(result.depthError).toBe(false);
        expect(result.renders < 20).toBe(true);
    });

    test("exactConfirmedAt stored as a string: no render loop", async () => {
        const result = await mount(
            openCreateEvent({
                precision: 4,
                city: "Cape Town",
                lngLat: LNG_LAT,
                exactConfirmedAt: "2026-10-01T00:00:00Z",
            }),
        );
        expect(result.depthError).toBe(false);
        expect(result.renders < 20).toBe(true);
    });

    test("precision missing: no render loop", async () => {
        const result = await mount(openCreateEvent({ city: "Cape Town", lngLat: LNG_LAT }));
        expect(result.depthError).toBe(false);
        expect(result.renders < 20).toBe(true);
    });

    test("precision of a different type (a string): no render loop", async () => {
        const result = await mount(openCreateEvent({ precision: "2", city: "Cape Town", lngLat: LNG_LAT }));
        expect(result.depthError).toBe(false);
        expect(result.renders < 20).toBe(true);
    });

    test("an ordinary City location: no render loop, and the address is prefilled", async () => {
        const result = await mount(openCreateEvent({ precision: 2, city: "Cape Town", lngLat: LNG_LAT }));
        expect(result.depthError).toBe(false);
        expect(result.renders < 20).toBe(true);
        expect(result.html).toContain("Cape Town");
    });

    test("no saved location: no render loop", async () => {
        const result = await mount(openCreateEvent(undefined));
        expect(result.depthError).toBe(false);
        expect(result.renders < 20).toBe(true);
    });
});

describe("LocationPicker with a parent that passes a new onChange on every render", () => {
    // Other forms (issues, tasks, goals, proposals) pass inline handlers too.
    const Parent = ({ initial }: { initial: any }) => {
        const [location, setLocation] = React.useState<any>(initial);
        pickerParentRenders += 1;
        if (pickerParentRenders > RENDER_CAP) throw new Error("Maximum update depth (test render cap)");
        return <LocationPicker value={location} onChange={(next) => setLocation(next)} compact />;
    };

    test("a location with exactConfirmedAt settles instead of looping", async () => {
        const store = createStore();
        const result = await mount(
            <Provider store={store}>
                <Parent initial={{ precision: 4, lngLat: LNG_LAT, exactConfirmedAt: new Date("2026-10-01") }} />
            </Provider>,
        );
        expect(result.depthError).toBe(false);
        expect(pickerParentRenders < 20).toBe(true);
    });

    test("a location that arrives with another precision still takes the picker's precision, as before", async () => {
        // The picker's slider starts at Exact for a non-profile location; a location handed in
        // later is set to that precision, so the slider and the stored value agree.
        let latest: any;
        const Prefilling = () => {
            const [location, setLocation] = React.useState<any>(undefined);
            React.useEffect(() => {
                setLocation({ precision: 2, city: "Cape Town", lngLat: LNG_LAT });
            }, []);
            latest = location;
            pickerParentRenders += 1;
            if (pickerParentRenders > RENDER_CAP) throw new Error("Maximum update depth (test render cap)");
            return <LocationPicker value={location} onChange={(next) => setLocation(next)} compact />;
        };
        const store = createStore();
        const result = await mount(
            <Provider store={store}>
                <Prefilling />
            </Provider>,
        );
        expect(result.depthError).toBe(false);
        expect(latest?.precision).toBe(4);
    });
});
