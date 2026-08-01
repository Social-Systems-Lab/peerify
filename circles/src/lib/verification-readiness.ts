import type { Circle } from "@/models/models";
import { DEFAULT_HERO_IMAGE_URLS } from "@/lib/default-heroes";
import {
    PEERIFY_DEFAULT_ARTIST_AVATAR_URL,
    PEERIFY_DEFAULT_BAND_AVATAR_URL,
    PEERIFY_DEFAULT_PROFILE_AVATAR_URL,
    PEERIFY_DEFAULT_VENUE_AVATAR_URL,
} from "@/lib/peerify/artist-profile";

export type VerificationReadinessItem = {
    key: "picture" | "coverImage" | "aboutText" | "location" | "guidelines";
    label: string;
    complete: boolean;
};

export type VerificationReadiness = {
    isReady: boolean;
    title: string;
    items: VerificationReadinessItem[];
};

const DEFAULT_PICTURE_URLS = new Set([
    "/images/default-picture.png",
    "/images/default-user-picture.png",
    PEERIFY_DEFAULT_PROFILE_AVATAR_URL,
    PEERIFY_DEFAULT_ARTIST_AVATAR_URL,
    PEERIFY_DEFAULT_BAND_AVATAR_URL,
    PEERIFY_DEFAULT_VENUE_AVATAR_URL,
]);
const DEFAULT_COVER_URLS = new Set(["/images/default-cover.png", ...DEFAULT_HERO_IMAGE_URLS]);

export const hasCustomPicture = (circle?: Partial<Circle> | null): boolean => {
    const url = circle?.picture?.url?.trim();
    return Boolean(url && !DEFAULT_PICTURE_URLS.has(url));
};

const hasCustomCoverImage = (circle?: Partial<Circle> | null): boolean =>
    Boolean(circle?.images?.some((image) => image.fileInfo?.url && !DEFAULT_COVER_URLS.has(image.fileInfo.url)));

export const hasAboutText = (circle?: Partial<Circle> | null): boolean => {
    if (circle?.circleType === "user") {
        return Boolean(circle.content?.trim() || circle.description?.trim());
    }

    return Boolean(circle?.content?.trim() || circle?.description?.trim());
};

// A "set" location means an actual map pin (lngLat), not just a precision default —
// LocationPicker (src/components/forms/location-picker.tsx) always writes lngLat when a
// place is picked (map click, search suggestion, or "Use Current Location"), and clearing
// it (handleClearLocation) writes back `{ precision }` with lngLat omitted.
export const hasLocationSet = (circle?: Partial<Circle> | null): boolean => {
    const lngLat = circle?.location?.lngLat;
    return Boolean(
        lngLat && Number.isFinite(lngLat.lat) && Number.isFinite(lngLat.lng),
    );
};

export const getVerificationReadiness = (circle?: Partial<Circle> | null): VerificationReadiness => {
    const isUserProfile = circle?.circleType === "user";

    const items: VerificationReadinessItem[] = isUserProfile
        ? [
              {
                  key: "picture",
                  label: "Add a profile picture",
                  complete: hasCustomPicture(circle),
              },
              {
                  key: "aboutText",
                  label: "Add About text",
                  complete: hasAboutText(circle),
              },
          ]
        : [
              {
                  key: "picture",
                  label: "Add a circle picture",
                  complete: hasCustomPicture(circle),
              },
              {
                  key: "coverImage",
                  label: "Add a cover image - the wide banner image at the top of the page",
                  complete: hasCustomCoverImage(circle),
              },
              {
                  key: "aboutText",
                  label: "Add About text",
                  complete: hasAboutText(circle),
              },
          ];

    return {
        isReady: items.every((item) => item.complete),
        title: isUserProfile
            ? "Complete your profile."
            : "Complete this circle before requesting verification.",
        items,
    };
};
