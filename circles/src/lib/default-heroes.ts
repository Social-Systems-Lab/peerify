import type { Circle, Media } from "@/models/models";
import { getPeerifyIdentityType, hasPeerifyArtistIntent } from "@/lib/peerify/artist-profile";

// Stock photos that createCircle()/createNewUser() used to save into a new circle's `images`
// (until the default hero moved to render time). Records created in that window still hold one
// of these URLs, so they must keep reading as "no custom hero" — and the files must stay in
// public/ while any record references them.
export const DEFAULT_HERO_IMAGE_URLS = [
    "/peerify/artist.jpg",
    "/peerify/fans.jpg",
    "/peerify/hosts.jpg",
    "/peerify/everyone.jpg",
    "/peerify/about.jpg",
    "/peerify/contact.jpg",
    "/peerify/involved.jpg",
] as const;

// The old Kamooni cover that every renderer used to fall back to.
const LEGACY_DEFAULT_COVER_URL = "/images/default-cover.png";

const DEFAULT_ILLUSTRATIONS_DIR = "/peerify/illustrations/defaults";

export const DEFAULT_HERO_URLS = {
    solo: `${DEFAULT_ILLUSTRATIONS_DIR}/hero-solo-waiting-chair-light.png`,
    band: `${DEFAULT_ILLUSTRATIONS_DIR}/hero-band-soundcheck.png`,
    dj: `${DEFAULT_ILLUSTRATIONS_DIR}/hero-dj-crates-lamp.png`,
    venue: `${DEFAULT_ILLUSTRATIONS_DIR}/hero-venue-cafe-corner.png`,
    personal: `${DEFAULT_ILLUSTRATIONS_DIR}/hero-personal-listener.png`,
} as const;

// For plain circles, and anywhere the profile type isn't known (events, broken image URLs).
export const FALLBACK_HERO_URL = DEFAULT_HERO_URLS.venue;

// The default illustrations are never saved, but are listed too so a record that somehow holds
// one (e.g. re-saved from an editor) still gets its own type's hero.
const STOCK_COVER_URLS = new Set<string>([
    ...DEFAULT_HERO_IMAGE_URLS,
    LEGACY_DEFAULT_COVER_URL,
    ...Object.values(DEFAULT_HERO_URLS),
]);

export const isStockCoverUrl = (url?: string): boolean => !url || STOCK_COVER_URLS.has(url);

/** The circle's uploaded cover images, without any stock/default ones. */
export const getCustomCoverImages = (images?: Media[]): Media[] =>
    (images || []).filter((image) => !isStockCoverUrl(image.fileInfo?.url));

export const getDefaultHeroUrl = (circle?: Partial<Circle> | null): string => {
    if (circle?.circleType === "user") {
        return DEFAULT_HERO_URLS.personal;
    }

    switch (getPeerifyIdentityType(circle)) {
        case "artist":
            return DEFAULT_HERO_URLS.solo;
        case "band":
            return DEFAULT_HERO_URLS.band;
        case "dj":
        case "producer":
            return DEFAULT_HERO_URLS.dj;
        case "venue":
            return DEFAULT_HERO_URLS.venue;
    }

    return hasPeerifyArtistIntent(circle) ? DEFAULT_HERO_URLS.solo : FALLBACK_HERO_URL;
};

/**
 * Cover images to render for a circle: its uploads if it has any, otherwise one default hero
 * chosen by profile type. Resolved at render time, never saved.
 */
export const getCircleCoverImages = (circle?: Partial<Circle> | null): Media[] => {
    const customImages = getCustomCoverImages(circle?.images);
    if (customImages.length > 0) {
        return customImages;
    }

    return [{ name: "Default cover", type: "image/png", fileInfo: { url: getDefaultHeroUrl(circle) } }];
};

export const getCircleCoverImageUrl = (circle?: Partial<Circle> | null): string =>
    getCircleCoverImages(circle)[0].fileInfo.url;
