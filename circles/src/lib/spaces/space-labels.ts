// Display words for spaces, shared by the owner's form and list and the admin page. Setting and
// step-free access use the event tags' own labels (event-tag-icons.ts), so they read the same as
// on events.

import { ACCESSIBILITY_ICON_META, SETTING_ICON_META } from "@/lib/peerify/event-tag-icons";
import type { EventTagAccessibility, EventTagSetting } from "@/lib/peerify/event-tags";
import type { SpaceDealPreference, SpaceType } from "@/models/models";

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
    popup: "Pop-up space",
    private: "Home or private space",
};

export const SPACE_DEAL_PREFERENCE_LABELS: Record<SpaceDealPreference, string> = {
    takings_share: "A share of the takings",
    fixed_fee: "A fixed fee",
    food_drinks: "Food and drinks",
    none: "Nothing, I just want to host",
};

export const SPACE_AMPLIFICATION_LABELS: Record<"acoustic_only" | "amplified_ok", string> = {
    acoustic_only: "Acoustic only",
    amplified_ok: "Amplified is OK",
};

export const spaceSettingLabel = (setting: EventTagSetting): string => SETTING_ICON_META[setting].label;

export const spaceStepFreeAccessLabel = (access: EventTagAccessibility): string => ACCESSIBILITY_ICON_META[access].label;

// Same wording as /hosts ("The listening rule", "What Peerify does, and what it doesn't").
export const LISTENING_RULE_TEXT =
    "I agree to the listening rule: shows in my space are for an audience that came to listen, not background music.";
export const HOST_RESPONSIBILITY_TEXT =
    "I understand the event is mine: I'm responsible for it, including any local rules on licensing, alcohol, noise and safety.";

// The three kinds as /hosts describes them, for the "Add a space" chooser.
export const SPACE_KIND_DESCRIPTIONS = {
    venue: "A place built for live music, with a stage, sound and lights. Gets a public venue profile.",
    popup: "A café after hours, a shop, a community centre or a room you can hire: not made for gigs, but able to hold a listening audience.",
    private: "A living room, garden, garage or shared co-op space. Your address and identity are never shown publicly.",
} as const;

// "Stockholm, Sweden": the most specific name first. Used for both types; a private space only has
// these names anyway.
export const spaceAreaLabel = (location: { city?: string; region?: string; country?: string } | undefined): string =>
    [location?.city ?? location?.region, location?.country].filter(Boolean).join(", ");
