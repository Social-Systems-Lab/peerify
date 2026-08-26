import {
    Circle,
    MemberDisplay,
    UserPrivate,
    Content,
    Media,
    ContentPreviewData,
    PostDisplay,
    UserToolboxData,
    AuthInfo,
    UserSettings,
    Feed, // Added Feed
    ChatMessage,
} from "@/models/models";
import { atom } from "jotai";

import { atomWithStorage } from "jotai/utils";

export const userAtom = atom<UserPrivate | undefined>(undefined);

export const authInfoAtom = atom<AuthInfo>({ authStatus: "loading" });
export const triggerMapOpenAtom = atom<boolean>(false);
export const mapOpenAtom = atom<boolean>(false);
export const mapboxKeyAtom = atom<string>("");
export const displayedContentAtom = atom<Content[]>([]);
export const zoomContentAtom = atom<Content | undefined>(undefined);
export const contentPreviewAtom = atom<ContentPreviewData | undefined>(undefined);
export const userToolboxDataAtom = atom<UserToolboxData | undefined>(undefined);
export const sidePanelContentVisibleAtom = atom<"content" | "toolbox" | undefined>(undefined);

// Left side panel (global) state
export type SidePanelMode = "none" | "activity" | "search" | "events";

export type SidePanelSearchState = {
    query: string;
    isSearching: boolean;
    hasSearched: boolean;
    selectedCategory?: string | null;
    selectedDateLabel?: string | null;
    items: (Circle | MemberDisplay)[];
    counts?: { communities: number; projects: number; users: number; events: number };
};

export const sidePanelModeAtom = atom<SidePanelMode>("none");
export const drawerContentAtom = atom<"explore" | "noticeboard" | "preview" | "events">("explore");
export const sidePanelSearchStateAtom = atom<SidePanelSearchState>({
    query: "",
    isSearching: false,
    hasSearched: false,
    selectedCategory: null,
    selectedDateLabel: null,
    items: [],
});
export const focusPostAtom = atom<PostDisplay | undefined>(undefined);
export const imageGalleryAtom = atom<{ images: Media[]; initialIndex: number } | null>(null);

export const unreadCountsAtom = atom<Record<string, number>>({});
export const notificationUnreadCountAtom = atom<number>(0);
export const latestMessagesAtom = atom<Record<string, any>>({});
export const roomDataAtom = atom<Record<string, any>>({});
export const roomMessagesAtom = atom<Record<string, ChatMessage[]>>({});
export const lastReadTimestampsAtom = atom<Record<string, number>>({});
export const userSettingsAtom = atomWithStorage<UserSettings>("userSettings", {
    feedTab: "following",
    circlesTab: "following",
});

export type CreatePostDialogAtomProps = {
    isOpen: boolean;
    circle?: Circle; // The circle context for the post
    feed?: Feed; // The feed context for the post
    sharedPost?: PostDisplay | null;
};

export const createPostDialogAtom = atom<CreatePostDialogAtomProps>({ isOpen: false });

export const replyToMessageAtom = atom<ChatMessage | null>(null);

// Command channel for map searches initiated from the left SearchResultsPanel.
// MapExplorer listens to this and runs the existing search/clear logic.
export const mapSearchCommandAtom = atom<{ query: string; timestamp: number } | null>(null);

// Portal target for the mobile Explore avatar/fan-out: MapExplorer publishes a ref to a
// slot at the trailing end of its search bar, and profile-menu.tsx portals its
// isMobileExplore UI into it instead of rendering in its usual fixed top-right position.
// Lets the avatar live inside the search bar's own DOM/flex layout while its state (unread
// counts, fan-out expansion, outside-tap-to-collapse) stays owned by profile-menu.tsx.
export const mobileExploreAvatarSlotAtom = atom<HTMLDivElement | null>(null);

// True while the mobile Explore search input is focused: MapExplorer sets this on the
// input's focus/blur, and profile-menu.tsx reads it to hide the embedded avatar/fan-out
// (collapsing the fan-out first if it was open) so the input can expand into that space —
// mirrors Google Maps hiding its account icon while search is active.
export const mobileExploreSearchFocusedAtom = atom<boolean>(false);

// Tracks whether the activity feed panel is docked (showing map alongside)
export const feedPanelDockedAtom = atom<boolean>(false);

// Chat settings modal state: { chatRoomId: string, isOpen: boolean }
export const chatSettingsModalAtom = atom<{ chatRoomId: string | null; isOpen: boolean }>({
    chatRoomId: null,
    isOpen: false,
});

// Persistent "who am I acting as" — the _id of a managed identity circle the account
// administers, or null for the account's own personal profile. Deliberately independent
// of the current route/page: it's only ever changed by an explicit switcher action (see
// useActingIdentity/useSetActingIdentity in @/lib/utils/acting-identity), and survives
// navigation and refresh via localStorage. Exported so the one-time route-based seed in
// profile-menu.tsx can tell "never chosen" (key absent) apart from "explicitly chose
// personal" (key present, stored as null) via a raw localStorage read.
export const ACTING_IDENTITY_STORAGE_KEY = "actingIdentityCircleId";
export const actingIdentityCircleIdAtom = atomWithStorage<string | null>(ACTING_IDENTITY_STORAGE_KEY, null);

// Set by PilotOnboardingFlow (src/components/onboarding/pilot/pilot-onboarding-flow.tsx) the
// moment someone exits the guided /onboarding/pilot sequence, either role. Read by
// HomeContent's welcome-dialog effect (src/components/modules/home/home-content.tsx) to
// suppress the generic "Welcome to Peerify" popup for accounts that already got a tailored
// walkthrough — showing it again (esp. the "are you an artist, use the Create button" copy on
// someone's own just-built artist circle) is redundant at best and nonsensical at worst.
export const PILOT_ONBOARDING_COMPLETED_STORAGE_KEY = "peerify_pilot_onboarding_completed";
