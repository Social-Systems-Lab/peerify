// Run: IS_BUILD=true bun test src/components/modules/home/limited-profile-connect.test.tsx
// Connect on a personal profile's limited version (Tim, 2026-11-24): the page and the preview,
// signed in only. Connect, or Requested with Withdraw, or Accept/Decline when they asked you.
// The status the button loads is the viewer's own request status only, and a silently declined
// request still reads "Requested". The page's payload for this (the DID) is checked in
// personal-profile-page.test.ts. The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectId } from "mongodb";
import { createStore, Provider } from "jotai";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/explore",
    useSearchParams: () => new URLSearchParams(),
}));

const { LimitedProfileConnectControls, LimitedProfileConnect, loadLimitedConnectStatus } = await import(
    "./limited-profile-connect"
);
const { PersonalProfilePlaceholder } = await import("./personal-profile-placeholder");
const { CirclePreview } = await import("@/components/layout/content-preview");
const { userAtom } = await import("@/lib/data/atoms");

const VIEWER = "did:test:viewer";
const PERSON = "did:test:person";
const noop = () => undefined;
const handlers = { onConnect: noop, onWithdraw: noop, onAccept: noop, onDecline: noop };
const controls = (status: any, canSend = true) =>
    renderToStaticMarkup(
        <LimitedProfileConnectControls status={status} canSend={canSend} busy={false} {...handlers} />,
    );

describe("the controls, by status", () => {
    test("no request yet: Connect", () => {
        const html = controls("none");
        expect(html).toContain(">Connect<");
        expect(html).not.toContain("aria-disabled");
    });

    test("an unverified viewer: Connect greyed out", () => {
        const html = controls("none", false);
        expect(html).toContain(">Connect<");
        expect(html).toContain('aria-disabled="true"');
    });

    test("next to Connect: they'll see your profile while they decide (2026-11-24)", () => {
        for (const canSend of [true, false]) {
            expect(controls("none", canSend)).toContain("They&#x27;ll see your profile while they decide.");
        }
        for (const status of ["pending_sent", "pending_received"]) {
            expect(controls(status)).not.toContain("see your profile while they decide");
        }
    });

    test("request sent: Requested, with Withdraw", () => {
        const html = controls("pending_sent");
        expect(html).toContain("Requested");
        expect(html).toContain(">Withdraw<");
        expect(html).not.toContain(">Connect<");
    });

    test("they asked you: Accept and Decline", () => {
        const html = controls("pending_received");
        expect(html).toContain(">Accept<");
        expect(html).toContain(">Decline<");
        expect(html).not.toContain(">Connect<");
    });

    test("before the status loads, and once connected: nothing", () => {
        expect(controls(null)).toBe("");
        expect(controls("accepted")).toBe("");
    });
});

describe("the status the button loads", () => {
    const edge = (fromDid: string, toDid: string, connectStatus: string, extra: Record<string, unknown> = {}) => ({
        _id: new ObjectId(),
        fromDid,
        toDid,
        connectStatus,
        ...extra,
    });

    beforeEach(() => {
        sessionDid = VIEWER;
        fakeDb.reset({ Circles: [], UserRelationships: [] });
    });

    test("only the status, nothing else", async () => {
        expect(await loadLimitedConnectStatus(PERSON)).toBe("none");
    });

    test("a request sent, and one received", async () => {
        fakeDb.col("UserRelationships").docs.push(edge(VIEWER, PERSON, "pending_sent"));
        expect(await loadLimitedConnectStatus(PERSON)).toBe("pending_sent");
        fakeDb.col("UserRelationships").docs.splice(0, 1, edge(VIEWER, PERSON, "pending_received"));
        expect(await loadLimitedConnectStatus(PERSON)).toBe("pending_received");
    });

    test("a declined request still reads Requested inside the cooldown (silent decline)", async () => {
        fakeDb
            .col("UserRelationships")
            .docs.push(edge(VIEWER, PERSON, "pending_sent", { declinedAt: new Date(Date.now() - 86_400_000) }));
        expect(await loadLimitedConnectStatus(PERSON)).toBe("pending_sent");
    });
});

// Finds an element of a given component in a server component's returned tree.
const findElement = (node: any, component: unknown): any => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findElement(item, component);
            if (found) return found;
        }
        return undefined;
    }
    if (node.type === component) return node;
    return findElement(node.props?.children, component);
};

describe("the limited page", () => {
    const profile = { handle: "person", name: "Person", pictureUrl: "https://cdn.example/p.png" };

    test("signed in: the Connect control, for this person's DID", () => {
        const tree = PersonalProfilePlaceholder({ profile, signedIn: true, connectDid: PERSON });
        expect(findElement(tree, LimitedProfileConnect)?.props).toEqual({ targetDid: PERSON });
    });

    test("signed out: no control, and Sign in as before", () => {
        const tree = PersonalProfilePlaceholder({ profile, signedIn: false });
        expect(findElement(tree, LimitedProfileConnect)).toBeUndefined();
        expect(renderToStaticMarkup(tree)).toContain("Sign in");
    });
});

describe("the limited preview", () => {
    const person = () =>
        ({
            _id: "650000000000000000000041",
            did: PERSON,
            handle: "person",
            name: "Person",
            circleType: "user",
            description: "CANARY description",
        }) as any;
    const render = (viewerDid?: string) => {
        const store = createStore();
        if (viewerDid) store.set(userAtom, { did: viewerDid, isVerified: true } as any);
        return renderToStaticMarkup(
            <Provider store={store}>
                <CirclePreview circle={person()} circleType="user" />
            </Provider>,
        );
    };

    test("signed in: the Connect control", () => {
        const html = render(VIEWER);
        expect(html).toContain("data-limited-connect");
        expect(html).not.toContain("CANARY");
    });

    test("an unverified superadmin gets Connect greyed out, like any unverified viewer", () => {
        const store = createStore();
        store.set(userAtom, { did: VIEWER, isAdmin: true, isVerified: false } as any);
        const html = renderToStaticMarkup(
            <Provider store={store}>
                <LimitedProfileConnect targetDid={PERSON} />
            </Provider>,
        );
        expect(html).toContain('data-can-connect="false"');
        store.set(userAtom, { did: VIEWER, isVerified: true } as any);
        expect(
            renderToStaticMarkup(
                <Provider store={store}>
                    <LimitedProfileConnect targetDid={PERSON} />
                </Provider>,
            ),
        ).toContain('data-can-connect="true"');
    });

    test("signed out, or your own profile: no control", () => {
        expect(render()).not.toContain("data-limited-connect");
        expect(render(PERSON)).not.toContain("data-limited-connect");
    });
});
