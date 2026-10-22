import { Circle } from "@/models/models";

export type PeerifyArtistIdentityType = "artist" | "band" | "dj" | "producer";
export type PeerifyVenueIdentityType = "venue";
export type PeerifyIdentityType = PeerifyArtistIdentityType | PeerifyVenueIdentityType;
export const PEERIFY_ARTIST_IDENTITY_TYPES = ["artist", "band", "dj", "producer"] as const;
export const PEERIFY_MANAGED_IDENTITY_TYPES = [...PEERIFY_ARTIST_IDENTITY_TYPES, "venue"] as const;

// Feature flags for parts of Peerify that are paused while they're reworked. Off hides every
// user-facing surface and makes the server refuse new use; stored data is left untouched, so
// flipping a flag back to true restores the feature as it was.
//
// Booking enquiries: artist Booking card + enquiry dialog, venue "Booking enquiries enabled"
// callout, both settings toggles, sendPeerifyArtistEnquiryAction's "booking" type. When turning
// this back on, also restore the landing page's Hosts & Venues line in peerify-landing-page.tsx
// ("List on the map & accept bookings", replaced by "List your venue on the map" while off).
export const PEERIFY_BOOKING_ENQUIRIES_ENABLED = false;
// Producer identity type: hidden from the Create Artist Identity dialog and refused by
// createPeerifyManagedArtistIdentityAction while off. "producer" stays a valid stored identityType, so existing
// producer circles keep rendering with their label.
export const PEERIFY_PRODUCER_IDENTITY_ENABLED = false;

export const PEERIFY_DEFAULT_PROFILE_AVATAR_URL = "/peerify/default-profile-avatar.png";
export const PEERIFY_DEFAULT_ARTIST_AVATAR_URL = "/peerify/default-artist-avatar.png";
export const PEERIFY_DEFAULT_BAND_AVATAR_URL = "/peerify/default-band-avatar.png";
export const PEERIFY_DEFAULT_VENUE_AVATAR_URL = "/peerify/default-venue-avatar.png";

const PEERIFY_LEGACY_DEFAULT_AVATAR_URLS = new Set([
    "/peerify/default-artist-avatar.svg",
    "/images/default-picture.png",
    "/images/default-user-picture.png",
]);

export type PeerifyMusicLinkKey =
    | "spotify"
    | "bandcamp"
    | "soundcloud"
    | "appleMusic"
    | "youtube"
    | "linktree"
    | "website";

export type PeerifyArtistProfile = {
    // Undefined until the artist picks one; read it through getPeerifyActFormat, which falls back
    // to identityType.
    actFormat?: PeerifyActFormat;
    actOffers: PeerifyActOffer[];
    artistTypes: string[];
    // Custom labels entered when "Other" is checked in artistTypes. General-purpose multi-tag
    // input, not a migration-only artifact — a new signup can add more than one (e.g. a
    // comedian-musician hybrid act checks "Other" and adds both "Comedian" and "Musician").
    artistTypeOtherLabels: string[];
    baseCity: string;
    genres: string[];
    primaryGenres: string[];
    primaryGenreOther?: string;
    musicLinks: Partial<Record<PeerifyMusicLinkKey, string>>;
    lookingFor: string[];
    bookingEnabled: boolean;
    bookingSettings: {
        localBookingsOnly?: boolean;
        travelRadiusKm?: number;
        preferredEventTypes?: string[];
        minimumAudienceSize?: number;
        preferredAudienceSize?: number;
        baseFee?: number;
        currency?: string;
        needsAccommodation?: boolean;
        needsTransport?: boolean;
        needsMeal?: boolean;
        technicalNeeds?: string;
        notes?: string;
    };
    availability?: string;
};

export type PeerifyVenueAddressVisibility = "private" | "city_area" | "public";
export type PeerifyVenueFeeCoveredBy = "venue" | "artist" | "shared" | "not_specified";

export type PeerifyVenueProfile = {
    venueTags?: string[];
    venueTagsOther?: string;
    publicCity?: string;
    address?: string;
    addressVisibility?: PeerifyVenueAddressVisibility;
    capacityStanding?: string;
    capacitySeated?: string;
    typicalShowCapacity?: string;
    accessibilityNotes?: string;
    agePolicy?: string;
    paAvailable?: boolean;
    inHouseEngineer?: boolean;
    backline?: string;
    lighting?: string;
    loadInNotes?: string;
    parkingNotes?: string;
    minimumFee?: string;
    doorSplit?: string;
    houseCut?: string;
    peerifyFeeCoveredBy?: PeerifyVenueFeeCoveredBy;
    availableDays?: string;
    typicalResponseTime?: string;
    bookingNote?: string;
    bookingEnquiriesEnabled?: boolean;
    greenRoom?: boolean;
    foodDrink?: string;
    accommodationHelp?: string;
    localTransportHelp?: string;
    merchTable?: boolean;
    guestListPolicy?: string;
    houseRules?: string;
    soundCurfew?: string;
    cancellationPolicy?: string;
    safetyPolicy?: string;
    website?: string;
    contactEmail?: string;
    phone?: string;
    otherInfo?: string;
};

export type PeerifyMetadata = {
    intent?: string;
    managedIdentity?: boolean;
    identityType?: PeerifyIdentityType;
    // Set only on the artist circle auto-provisioned by pilot signup (see
    // createPilotArtistCircle in src/components/forms/signup/actions.ts). Scopes the
    // draft->published auto-transition in updateCircle to just this circle, so
    // manually-created Peerify identities (CircleWizard) keep requiring the existing
    // verification-request -> admin-approval flow.
    autoProvisionedFromSignup?: boolean;
    artistProfile?: PeerifyArtistProfile;
    venueProfile?: PeerifyVenueProfile;
};

export type PeerifyArtistEnquiryType = "pledge" | "booking";

export type PeerifyPledgeEnquiryInput = {
    fanLocation?: string;
    maximumTicketAmount?: string;
    // Fan-selected, not derived from the artist's own booking-settings currency — see
    // pledge-dialog.tsx's currency dropdown (defaulted from the fan's location, but always
    // editable and always the fan's own choice, decoupled from the artist's settings).
    currency?: string;
    preferredEventType?: string;
    helpOptions?: string[];
    // Only meaningful when helpOptions includes "Host" — see pledge-dialog.tsx's reveal field.
    // Replaces the old standalone "Space for 20-30 people" checkbox.
    hostingCapacity?: string;
    note?: string;
};

export type PeerifyBookingEnquiryInput = {
    bookerLocation?: string;
    eventType?: string;
    expectedAudienceSize?: string;
    possibleDateRange?: string;
    setting?: string;
    accommodationAvailable?: boolean;
    localTransportAvailable?: boolean;
    foodHospitalityAvailable?: boolean;
    soundEquipmentAvailable?: boolean;
    message?: string;
};

// Legacy: the old Settings "Artist types" checkboxes. No longer offered (act format replaced them,
// 2026-10-22); kept so stored values still normalise. Nothing reads artistTypes for display now.
export const PEERIFY_ARTIST_TYPE_OPTIONS = ["Solo artist", "Band", "DJ", "Other"] as const;

// Act format: one per artist. Stored in artistProfile.actFormat. An artist who never chose one
// reads as the format their identityType implies (getPeerifyActFormat), so existing profiles
// filter correctly without a migration. Duo and Ensemble only ever come from an explicit choice.
export const PEERIFY_ACT_FORMAT_OPTIONS = [
    { value: "solo", label: "Solo" },
    { value: "duo", label: "Duo" },
    { value: "band", label: "Band" },
    { value: "dj_producer", label: "DJ / Producer" },
    { value: "ensemble", label: "Ensemble" },
] as const;
export type PeerifyActFormat = (typeof PEERIFY_ACT_FORMAT_OPTIONS)[number]["value"];
export const PEERIFY_ACT_FORMATS = PEERIFY_ACT_FORMAT_OPTIONS.map((option) => option.value) as PeerifyActFormat[];

// "What you do": any number per artist. Stored in artistProfile.actOffers as these slugs, so a
// label can be reworded without touching stored data (Lessons, Composing and Sound healing kept
// their slugs when their labels were shortened, 2026-10-22). Not "offers": that name already means
// tourTeamOfferings (map Offers category, offer pins). A slug removed from this list
// (songwriting, production_engineering, comedy_spoken_word: split into comedy + spoken_word;
// original_music, removed after the prod launch, 2026-10-22) is
// dropped on read by normalizeActOffers, so it never shows as a badge or matches a filter.
export const PEERIFY_ACT_OFFER_OPTIONS = [
    { value: "covers_tributes", label: "Covers and tributes" },
    { value: "dj_sets", label: "DJ sets" },
    { value: "session_musician", label: "Session musician" },
    { value: "lessons_workshops", label: "Lessons" },
    { value: "composing_film_games_theatre", label: "Composing" },
    { value: "childrens_music", label: "Children's music" },
    { value: "sound_healing_meditation", label: "Sound healing" },
    { value: "comedy", label: "Comedy" },
    { value: "spoken_word", label: "Spoken word" },
    { value: "weddings_private_events", label: "Weddings and private events" },
] as const;
export type PeerifyActOffer = (typeof PEERIFY_ACT_OFFER_OPTIONS)[number]["value"];
export const PEERIFY_ACT_OFFERS = PEERIFY_ACT_OFFER_OPTIONS.map((option) => option.value) as PeerifyActOffer[];

export const PEERIFY_ACT_FORMAT_LABELS = Object.fromEntries(
    PEERIFY_ACT_FORMAT_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PeerifyActFormat, string>;
export const PEERIFY_ACT_OFFER_LABELS = Object.fromEntries(
    PEERIFY_ACT_OFFER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PeerifyActOffer, string>;

export const PRIMARY_GENRE_OPTIONS = [
    "Acoustic",
    "Alternative",
    "Ambient",
    "Blues",
    "Classical",
    "Country",
    "Dance",
    "Electronic",
    "Experimental",
    "Folk",
    "Funk",
    "Gospel & Spiritual",
    "Hip-Hop & Rap",
    "Indie",
    "Instrumental",
    "Jazz",
    "Latin",
    "Metal",
    "Pop",
    "Punk",
    "R&B & Soul",
    "Reggae",
    "Rock",
    "Singer-Songwriter",
    "Ska",
    "Soundtrack & Score",
    "Traditional & Regional",
    "African & African Diaspora",
    "Global & Cross-Cultural",
    "Spoken Word",
    "Children's Music",
    "Comedy & Musical Performance",
    "Other",
] as const;

export const PRIMARY_GENRE_MAX_SELECTIONS = 3;

export const formatPrimaryGenreLabel = (genre: string, other?: string): string =>
    genre === "Other" && other ? `Other (${other})` : genre;

// Replaces the old single-select venueType field — same 10 real categories that field's
// <select> offered (minus its "Select venue type" placeholder, which has no meaning in a
// multi-select). Deliberately no selection cap, unlike PRIMARY_GENRE_MAX_SELECTIONS: a venue can
// genuinely be several of these at once (e.g. both "Bar" and "Outdoor"), and at only 10 options
// an unbounded multi-select isn't unwieldy the way it would be for the much larger genre list.
export const VENUE_TAG_OPTIONS = [
    "Bar",
    "Café",
    "Club",
    "Theatre",
    "Gallery",
    "Community space",
    "House venue",
    "Outdoor",
    "Studio",
    "Other",
] as const;

export const formatVenueTagLabel = (tag: string, other?: string): string =>
    tag === "Other" && other ? `Other (${other})` : tag;

export const PEERIFY_MANAGED_IDENTITY_TYPE_OPTIONS: ReadonlyArray<{
    value: PeerifyArtistIdentityType;
    label: string;
    description: string;
}> = [
    {
        value: "artist",
        label: "Artist / Solo Project",
        description: "A public identity for a solo act or personal music project.",
    },
    {
        value: "band",
        label: "Band",
        description: "A public identity for a band or group.",
    },
    {
        value: "dj",
        label: "DJ",
        description: "A public identity for a DJ project.",
    },
    {
        value: "producer",
        label: "Producer",
        description: "A public identity for a producer or beatmaker project.",
    },
] as const;

// The identity types a user can choose when creating a new artist identity.
export const PEERIFY_SELECTABLE_IDENTITY_TYPE_OPTIONS = PEERIFY_MANAGED_IDENTITY_TYPE_OPTIONS.filter(
    (option) => option.value !== "producer" || PEERIFY_PRODUCER_IDENTITY_ENABLED,
);

export const isPeerifyIdentityTypeSelectable = (identityType: PeerifyArtistIdentityType): boolean =>
    PEERIFY_SELECTABLE_IDENTITY_TYPE_OPTIONS.some((option) => option.value === identityType);

export const PEERIFY_MANAGED_IDENTITY_TYPE_LABELS: Record<PeerifyIdentityType, string> = {
    artist: "Artist / Solo Project",
    band: "Band",
    dj: "DJ",
    producer: "Producer",
    venue: "Venue",
};

export const PEERIFY_LOOKING_FOR_OPTIONS = [
    "Shows",
    "House concerts",
    "Festivals",
    "Collaborators",
    "Promoters",
    "Hosts",
    "Fans",
    "Press",
] as const;

export const PEERIFY_EVENT_TYPE_OPTIONS = [
    "House concert",
    "Listening room",
    "Club show",
    "Festival",
    "Private event",
    "Community event",
    "Support slot",
    "Workshop",
] as const;

// "Attend" was removed (redundant — pledging already implies interest in attending). "Space for
// 20-30 people" was removed as its own checkbox and replaced by the free-text `hostingCapacity`
// field (PeerifyPledgeEnquiryInput below), revealed only when "Host" is checked — see
// pledge-dialog.tsx. That field feeds the same places this checkbox used to (Pledge Dashboard,
// chat-enquiry fallback message), so nothing downstream lost visibility into hosting capacity.
export const PEERIFY_PLEDGE_HELP_OPTIONS = [
    "Promote",
    "Host",
    "Local transport",
    "Spare room",
    "Food / hospitality",
    "Sound / equipment",
] as const;

export const PEERIFY_BOOKING_SUPPORT_OPTIONS = [
    "Accommodation available",
    "Local transport available",
    "Food / hospitality available",
    "Sound equipment available",
] as const;

// Curated shortlist, not the full ISO 4217 list (~180 currencies) — covers the currencies
// realistically expected from artists' likely locations without scroll-hunting. Shared between
// Booking settings' Currency field and anywhere else that needs the same list, so the two never
// drift apart. If a circle already has a saved value outside this list (e.g. from the old
// free-text field), the caller should append it as an extra option at render time rather than
// dropping it — see the `currency` Controller in about-settings-form.tsx.
export const PEERIFY_CURRENCY_OPTIONS = [
    { value: "", label: "Select currency" },
    { value: "USD", label: "USD — US Dollar" },
    { value: "EUR", label: "EUR — Euro" },
    { value: "GBP", label: "GBP — British Pound" },
    { value: "ZAR", label: "ZAR — South African Rand" },
    { value: "SEK", label: "SEK — Swedish Krona" },
    { value: "NOK", label: "NOK — Norwegian Krone" },
    { value: "DKK", label: "DKK — Danish Krone" },
    { value: "CHF", label: "CHF — Swiss Franc" },
    { value: "CAD", label: "CAD — Canadian Dollar" },
    { value: "AUD", label: "AUD — Australian Dollar" },
    { value: "NGN", label: "NGN — Nigerian Naira" },
    { value: "KES", label: "KES — Kenyan Shilling" },
    { value: "BRL", label: "BRL — Brazilian Real" },
    { value: "JPY", label: "JPY — Japanese Yen" },
    { value: "INR", label: "INR — Indian Rupee" },
    { value: "MXN", label: "MXN — Mexican Peso" },
] as const;

export const PEERIFY_MUSIC_LINK_LABELS: Record<PeerifyMusicLinkKey, string> = {
    spotify: "Spotify",
    bandcamp: "Bandcamp",
    soundcloud: "SoundCloud",
    appleMusic: "Apple Music",
    youtube: "YouTube",
    linktree: "Linktree",
    website: "Website",
};

const DEFAULT_ARTIST_PROFILE: PeerifyArtistProfile = {
    actOffers: [],
    artistTypes: [],
    artistTypeOtherLabels: [],
    baseCity: "",
    genres: [],
    primaryGenres: [],
    primaryGenreOther: "",
    musicLinks: {},
    lookingFor: [],
    bookingEnabled: false,
    bookingSettings: {},
    availability: "",
};

const DEFAULT_VENUE_PROFILE: PeerifyVenueProfile = {
    venueTags: [],
    venueTagsOther: "",
    publicCity: "",
    address: "",
    addressVisibility: "private",
    capacityStanding: "",
    capacitySeated: "",
    typicalShowCapacity: "",
    accessibilityNotes: "",
    agePolicy: "",
    paAvailable: false,
    inHouseEngineer: false,
    backline: "",
    lighting: "",
    loadInNotes: "",
    parkingNotes: "",
    minimumFee: "",
    doorSplit: "",
    houseCut: "",
    peerifyFeeCoveredBy: "not_specified",
    availableDays: "",
    typicalResponseTime: "",
    bookingNote: "",
    bookingEnquiriesEnabled: false,
    greenRoom: false,
    foodDrink: "",
    accommodationHelp: "",
    localTransportHelp: "",
    merchTable: false,
    guestListPolicy: "",
    houseRules: "",
    soundCurfew: "",
    cancellationPolicy: "",
    safetyPolicy: "",
    website: "",
    contactEmail: "",
    phone: "",
    otherInfo: "",
};

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const normalizeExternalUrl = (value: unknown): string => {
    const nextValue = asString(value);
    if (!nextValue) {
        return "";
    }

    if (/^https?:\/\//i.test(nextValue)) {
        return nextValue;
    }

    return `https://${nextValue}`;
};

const asStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((item) => asString(item)).filter(Boolean);
};

const asOptionalNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return undefined;
};

const asOptionalBoolean = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

const normalizePrimaryGenres = (value: unknown): string[] => {
    const validOptions = PRIMARY_GENRE_OPTIONS as readonly string[];
    const nextValues = asStringArray(value).filter((genre) => validOptions.includes(genre));
    return Array.from(new Set(nextValues)).slice(0, PRIMARY_GENRE_MAX_SELECTIONS);
};

const normalizeActFormat = (value: unknown): PeerifyActFormat | undefined => {
    const nextValue = asString(value);
    return (PEERIFY_ACT_FORMATS as string[]).includes(nextValue) ? (nextValue as PeerifyActFormat) : undefined;
};

// Unknown values are dropped (unlike artistTypes, which kept any string), and the order is the
// option order, so the badges and the filter row always list them the same way.
const normalizeActOffers = (value: unknown): PeerifyActOffer[] => {
    const nextValues = new Set(asStringArray(value));
    return PEERIFY_ACT_OFFERS.filter((offer) => nextValues.has(offer));
};

const normalizeArtistTypeOtherLabels = (value: unknown): string[] => {
    const nextValues = asStringArray(value)
        .map((label) => label.trim())
        .filter(Boolean);
    return Array.from(new Set(nextValues));
};

// hasVenueTagsField distinguishes "this document predates venueTags" from "venueTags was
// explicitly saved as empty" - only the former falls back to the legacy venueType value. Once a
// venue's settings are saved even once under the new shape, venueTags exists on the document
// (even as []) and this fallback stops applying to it, as intended - it's a one-time read-time
// bridge for pre-migration documents (e.g. the one real venue circle with venueType: "Theatre" at
// the time of this change), not a permanent alternate source of truth. No DB write involved.
const normalizeVenueTags = (value: unknown, legacyVenueType: unknown, hasVenueTagsField: boolean): string[] => {
    const validOptions = VENUE_TAG_OPTIONS as readonly string[];
    const nextValues = Array.from(new Set(asStringArray(value).filter((tag) => validOptions.includes(tag))));

    if (hasVenueTagsField) {
        return nextValues;
    }

    const legacyTag = asString(legacyVenueType);
    return legacyTag && validOptions.includes(legacyTag) ? [legacyTag] : nextValues;
};

const normalizeVenueAddressVisibility = (value: unknown): PeerifyVenueAddressVisibility => {
    const nextValue = asString(value);
    return nextValue === "city_area" || nextValue === "public" || nextValue === "private" ? nextValue : "private";
};

const normalizeVenueFeeCoveredBy = (value: unknown): PeerifyVenueFeeCoveredBy => {
    const nextValue = asString(value);
    return nextValue === "venue" || nextValue === "artist" || nextValue === "shared" || nextValue === "not_specified"
        ? nextValue
        : "not_specified";
};

const normalizeMusicLinks = (value: unknown): Partial<Record<PeerifyMusicLinkKey, string>> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const input = value as Record<string, unknown>;
    const result: Partial<Record<PeerifyMusicLinkKey, string>> = {};

    (Object.keys(PEERIFY_MUSIC_LINK_LABELS) as PeerifyMusicLinkKey[]).forEach((key) => {
        const nextValue = normalizeExternalUrl(input[key]);
        if (nextValue) {
            result[key] = nextValue;
        }
    });

    return result;
};

export const normalizePeerifyArtistProfile = (value: unknown): PeerifyArtistProfile => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ...DEFAULT_ARTIST_PROFILE, bookingSettings: {}, musicLinks: {} };
    }

    const input = value as Record<string, unknown>;

    const actFormat = normalizeActFormat(input.actFormat);

    return {
        ...(actFormat ? { actFormat } : {}),
        actOffers: normalizeActOffers(input.actOffers),
        artistTypes: asStringArray(input.artistTypes),
        artistTypeOtherLabels: normalizeArtistTypeOtherLabels(input.artistTypeOtherLabels),
        baseCity: asString(input.baseCity),
        genres: asStringArray(input.genres),
        primaryGenres: normalizePrimaryGenres(input.primaryGenres),
        primaryGenreOther: asString(input.primaryGenreOther),
        musicLinks: normalizeMusicLinks(input.musicLinks),
        lookingFor: asStringArray(input.lookingFor),
        bookingEnabled: input.bookingEnabled === true,
        bookingSettings: {
            localBookingsOnly: asOptionalBoolean(
                (input.bookingSettings as Record<string, unknown> | undefined)?.localBookingsOnly,
            ),
            travelRadiusKm: asOptionalNumber(
                (input.bookingSettings as Record<string, unknown> | undefined)?.travelRadiusKm,
            ),
            preferredEventTypes: asStringArray(
                (input.bookingSettings as Record<string, unknown> | undefined)?.preferredEventTypes,
            ),
            minimumAudienceSize: asOptionalNumber(
                (input.bookingSettings as Record<string, unknown> | undefined)?.minimumAudienceSize,
            ),
            preferredAudienceSize: asOptionalNumber(
                (input.bookingSettings as Record<string, unknown> | undefined)?.preferredAudienceSize,
            ),
            baseFee: asOptionalNumber((input.bookingSettings as Record<string, unknown> | undefined)?.baseFee),
            currency: asString((input.bookingSettings as Record<string, unknown> | undefined)?.currency),
            needsAccommodation: asOptionalBoolean(
                (input.bookingSettings as Record<string, unknown> | undefined)?.needsAccommodation,
            ),
            needsTransport: asOptionalBoolean(
                (input.bookingSettings as Record<string, unknown> | undefined)?.needsTransport,
            ),
            needsMeal: asOptionalBoolean((input.bookingSettings as Record<string, unknown> | undefined)?.needsMeal),
            technicalNeeds: asString((input.bookingSettings as Record<string, unknown> | undefined)?.technicalNeeds),
            notes: asString((input.bookingSettings as Record<string, unknown> | undefined)?.notes),
        },
        availability: asString(input.availability),
    };
};

export const normalizePeerifyVenueProfile = (value: unknown): PeerifyVenueProfile => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ...DEFAULT_VENUE_PROFILE };
    }

    const input = value as Record<string, unknown>;

    return {
        venueTags: normalizeVenueTags(input.venueTags, input.venueType, "venueTags" in input),
        venueTagsOther: asString(input.venueTagsOther),
        publicCity: asString(input.publicCity),
        address: asString(input.address),
        addressVisibility: normalizeVenueAddressVisibility(input.addressVisibility),
        capacityStanding: asString(input.capacityStanding),
        capacitySeated: asString(input.capacitySeated),
        typicalShowCapacity: asString(input.typicalShowCapacity),
        accessibilityNotes: asString(input.accessibilityNotes),
        agePolicy: asString(input.agePolicy),
        paAvailable: input.paAvailable === true,
        inHouseEngineer: input.inHouseEngineer === true,
        backline: asString(input.backline),
        lighting: asString(input.lighting),
        loadInNotes: asString(input.loadInNotes),
        parkingNotes: asString(input.parkingNotes),
        minimumFee: asString(input.minimumFee),
        doorSplit: asString(input.doorSplit),
        houseCut: asString(input.houseCut),
        peerifyFeeCoveredBy: normalizeVenueFeeCoveredBy(input.peerifyFeeCoveredBy),
        availableDays: asString(input.availableDays),
        typicalResponseTime: asString(input.typicalResponseTime),
        bookingNote: asString(input.bookingNote),
        bookingEnquiriesEnabled: input.bookingEnquiriesEnabled === true,
        greenRoom: input.greenRoom === true,
        foodDrink: asString(input.foodDrink),
        accommodationHelp: asString(input.accommodationHelp),
        localTransportHelp: asString(input.localTransportHelp),
        merchTable: input.merchTable === true,
        guestListPolicy: asString(input.guestListPolicy),
        houseRules: asString(input.houseRules),
        soundCurfew: asString(input.soundCurfew),
        cancellationPolicy: asString(input.cancellationPolicy),
        safetyPolicy: asString(input.safetyPolicy),
        website: normalizeExternalUrl(input.website),
        contactEmail: asString(input.contactEmail),
        phone: asString(input.phone),
        otherInfo: asString(input.otherInfo),
    };
};

export const getPeerifyMetadata = (circle?: Partial<Circle> | null): PeerifyMetadata => {
    const peerify = (circle?.metadata as Record<string, unknown> | undefined)?.peerify;
    if (!peerify || typeof peerify !== "object" || Array.isArray(peerify)) {
        return {};
    }

    const input = peerify as Record<string, unknown>;

    return {
        intent: asString(input.intent) || undefined,
        managedIdentity: input.managedIdentity === true,
        identityType: PEERIFY_MANAGED_IDENTITY_TYPES.includes(asString(input.identityType) as PeerifyIdentityType)
            ? (asString(input.identityType) as PeerifyIdentityType)
            : undefined,
        autoProvisionedFromSignup: input.autoProvisionedFromSignup === true,
        artistProfile: normalizePeerifyArtistProfile(input.artistProfile),
        venueProfile: normalizePeerifyVenueProfile(input.venueProfile),
    };
};

export const getPeerifyArtistProfile = (circle?: Partial<Circle> | null): PeerifyArtistProfile =>
    getPeerifyMetadata(circle).artistProfile ?? { ...DEFAULT_ARTIST_PROFILE, bookingSettings: {}, musicLinks: {} };

export const getPeerifyVenueProfile = (circle?: Partial<Circle> | null): PeerifyVenueProfile =>
    getPeerifyMetadata(circle).venueProfile ?? { ...DEFAULT_VENUE_PROFILE };

export const hasPeerifyArtistIntent = (circle?: Partial<Circle> | null): boolean => {
    const peerifyMetadata = getPeerifyMetadata(circle);
    return peerifyMetadata.intent === "artist";
};

export const isPeerifyManagedIdentity = (circle?: Partial<Circle> | null): boolean =>
    getPeerifyMetadata(circle).managedIdentity === true;

export const getPeerifyIdentityType = (circle?: Partial<Circle> | null): PeerifyIdentityType | undefined =>
    getPeerifyMetadata(circle).identityType;

export const isPeerifyArtistIdentity = (circle?: Partial<Circle> | null): boolean => {
    if (hasPeerifyArtistIntent(circle)) {
        return true;
    }

    const peerifyMetadata = getPeerifyMetadata(circle);
    return (
        peerifyMetadata.managedIdentity === true &&
        typeof peerifyMetadata.identityType === "string" &&
        PEERIFY_ARTIST_IDENTITY_TYPES.includes(peerifyMetadata.identityType as PeerifyArtistIdentityType)
    );
};

export const isPeerifyVenueIdentity = (circle?: Partial<Circle> | null): boolean => {
    const peerifyMetadata = getPeerifyMetadata(circle);
    return peerifyMetadata.managedIdentity === true && peerifyMetadata.identityType === "venue";
};

export const getPeerifyDefaultAvatarUrl = (identityType?: PeerifyIdentityType): string => {
    if (identityType === "venue") {
        return PEERIFY_DEFAULT_VENUE_AVATAR_URL;
    }

    if (identityType === "band") {
        return PEERIFY_DEFAULT_BAND_AVATAR_URL;
    }

    return PEERIFY_DEFAULT_ARTIST_AVATAR_URL;
};

export const getPeerifyIdentityAvatarUrl = (circle?: Partial<Circle> | null): string => {
    const currentPictureUrl = asString(circle?.picture?.url);
    if (currentPictureUrl && !PEERIFY_LEGACY_DEFAULT_AVATAR_URLS.has(currentPictureUrl)) {
        return currentPictureUrl;
    }

    return getPeerifyDefaultAvatarUrl(getPeerifyIdentityType(circle));
};

export const getPeerifyArtistIdentityLabel = (circle?: Partial<Circle> | null): string => {
    const identityType = getPeerifyIdentityType(circle);
    return identityType ? PEERIFY_MANAGED_IDENTITY_TYPE_LABELS[identityType] : "Artist";
};

// The act format an artist's identityType implies, for artists who haven't picked one. Mirrors
// getDefaultHeroUrl: an intent-only artist (no artist identityType) reads as solo.
const ACT_FORMAT_BY_IDENTITY_TYPE: Record<PeerifyArtistIdentityType, PeerifyActFormat> = {
    artist: "solo",
    band: "band",
    dj: "dj_producer",
    producer: "dj_producer",
};

export const getPeerifyActFormat = (circle?: Partial<Circle> | null): PeerifyActFormat | undefined => {
    const peerifyMetadata = getPeerifyMetadata(circle);
    if (peerifyMetadata.artistProfile?.actFormat) {
        return peerifyMetadata.artistProfile.actFormat;
    }

    const identityType = peerifyMetadata.identityType;
    if (identityType && identityType !== "venue") {
        return ACT_FORMAT_BY_IDENTITY_TYPE[identityType];
    }

    return peerifyMetadata.intent === "artist" ? "solo" : undefined;
};

export const getPeerifyActOffers = (circle?: Partial<Circle> | null): PeerifyActOffer[] =>
    getPeerifyArtistProfile(circle).actOffers;

// The identityType to store alongside a chosen act format, so the default hero, avatar and label
// (which all key off identityType) follow the format. A producer stays a producer when the format
// is DJ / Producer.
export const getIdentityTypeForActFormat = (
    actFormat: PeerifyActFormat,
    currentIdentityType?: PeerifyIdentityType,
): PeerifyArtistIdentityType => {
    switch (actFormat) {
        case "solo":
        case "duo":
            return "artist";
        case "band":
        case "ensemble":
            return "band";
        case "dj_producer":
            return currentIdentityType === "producer" ? "producer" : "dj";
    }
};

// Act format, then "What you do", then the free-text "describe your act" tags. The format badge
// shows only when the artist chose one: the identityType fallback is for filtering, not display.
export const getPeerifyArtistTypeBadges = (circle?: Partial<Circle> | null): string[] => {
    const artistProfile = getPeerifyArtistProfile(circle);
    return [
        ...(artistProfile.actFormat ? [PEERIFY_ACT_FORMAT_LABELS[artistProfile.actFormat]] : []),
        ...artistProfile.actOffers.map((offer) => PEERIFY_ACT_OFFER_LABELS[offer]),
        ...artistProfile.artistTypeOtherLabels,
    ];
};

// ---- Act filters (Discover, Explore) ----
// Artist profiles only: a circle that isn't an artist always passes, so venues, events and offer
// pins are never narrowed by these. Any-of within each list; both lists must match when both are set.

export type PeerifyActFilters = {
    actFormats?: string[];
    actOffers?: string[];
};

const cleanActFilters = (filters?: PeerifyActFilters) => ({
    actFormats: (filters?.actFormats ?? []).filter((v): v is PeerifyActFormat =>
        (PEERIFY_ACT_FORMATS as string[]).includes(v),
    ),
    actOffers: (filters?.actOffers ?? []).filter((v): v is PeerifyActOffer => (PEERIFY_ACT_OFFERS as string[]).includes(v)),
});

export const hasActFilters = (filters?: PeerifyActFilters): boolean => {
    const { actFormats, actOffers } = cleanActFilters(filters);
    return actFormats.length > 0 || actOffers.length > 0;
};

export const matchesActFilters = (circle: Partial<Circle> | null | undefined, filters?: PeerifyActFilters): boolean => {
    const { actFormats, actOffers } = cleanActFilters(filters);
    if (actFormats.length === 0 && actOffers.length === 0) {
        return true;
    }
    if (!isPeerifyArtistIdentity(circle)) {
        return true;
    }

    if (actFormats.length > 0) {
        const actFormat = getPeerifyActFormat(circle);
        if (!actFormat || !actFormats.includes(actFormat)) {
            return false;
        }
    }

    if (actOffers.length > 0) {
        const circleOffers = getPeerifyActOffers(circle);
        if (!actOffers.some((offer) => circleOffers.includes(offer))) {
            return false;
        }
    }

    return true;
};

const ARTIST_PROFILE_PATH = "metadata.peerify.artistProfile";
const ARTIST_IDENTITY_MONGO_QUERY = {
    $or: [
        { "metadata.peerify.intent": "artist" },
        {
            "metadata.peerify.managedIdentity": true,
            "metadata.peerify.identityType": { $in: [...PEERIFY_ARTIST_IDENTITY_TYPES] },
        },
    ],
};

/**
 * The Mongo form of matchesActFilters, for searchDiscoverableCircles: undefined when no act filter
 * is set. Keep the two in step (act-filters.test.ts runs both over the same circles). The format
 * part mirrors getPeerifyActFormat's fallback: an artist with no valid actFormat matches through
 * its identityType ($nin also matches a missing field).
 */
export const buildActFilterMongoQuery = (filters?: PeerifyActFilters): Record<string, unknown> | undefined => {
    const { actFormats, actOffers } = cleanActFilters(filters);
    if (actFormats.length === 0 && actOffers.length === 0) {
        return undefined;
    }

    const artistClauses: Record<string, unknown>[] = [];

    if (actFormats.length > 0) {
        const noChosenFormat = { [`${ARTIST_PROFILE_PATH}.actFormat`]: { $nin: PEERIFY_ACT_FORMATS } };
        const impliedIdentityTypes = PEERIFY_ARTIST_IDENTITY_TYPES.filter((identityType) =>
            actFormats.includes(ACT_FORMAT_BY_IDENTITY_TYPE[identityType]),
        );
        const formatClauses: Record<string, unknown>[] = [
            { [`${ARTIST_PROFILE_PATH}.actFormat`]: { $in: actFormats } },
        ];
        if (impliedIdentityTypes.length > 0) {
            formatClauses.push({ ...noChosenFormat, "metadata.peerify.identityType": { $in: impliedIdentityTypes } });
        }
        if (actFormats.includes("solo")) {
            formatClauses.push({
                ...noChosenFormat,
                "metadata.peerify.identityType": { $nin: [...PEERIFY_ARTIST_IDENTITY_TYPES] },
                "metadata.peerify.intent": "artist",
            });
        }
        artistClauses.push({ $or: formatClauses });
    }

    if (actOffers.length > 0) {
        artistClauses.push({ [`${ARTIST_PROFILE_PATH}.actOffers`]: { $in: actOffers } });
    }

    return { $or: [{ $nor: [ARTIST_IDENTITY_MONGO_QUERY] }, { $and: artistClauses }] };
};

export const hasPeerifyArtistProfileContent = (profile: PeerifyArtistProfile): boolean =>
    Boolean(profile.actFormat) ||
    profile.actOffers.length > 0 ||
    profile.artistTypeOtherLabels.length > 0 ||
    profile.artistTypes.length > 0 ||
    profile.genres.length > 0 ||
    profile.primaryGenres.length > 0 ||
    Boolean(profile.baseCity) ||
    Object.keys(profile.musicLinks).length > 0 ||
    profile.lookingFor.length > 0 ||
    profile.bookingEnabled ||
    Boolean(profile.availability);

// Mirrors the presence check venue-booking-detail.tsx uses to decide whether there's anything to
// show across Room & Capacity, Technical setup, Booking terms, Hospitality & support, and House
// rules & policies — the shared source of truth for the About page's Venue Info "Booking info"
// link, and the dedicated booking page's own empty-state gate, so the three stay in sync without
// duplicating the field list.
export const hasPeerifyVenueProfileContent = (profile: PeerifyVenueProfile): boolean =>
    Boolean(profile.capacityStanding) ||
    Boolean(profile.capacitySeated) ||
    Boolean(profile.typicalShowCapacity) ||
    Boolean(profile.accessibilityNotes) ||
    Boolean(profile.agePolicy) ||
    profile.paAvailable === true ||
    profile.inHouseEngineer === true ||
    Boolean(profile.backline) ||
    Boolean(profile.lighting) ||
    Boolean(profile.loadInNotes) ||
    Boolean(profile.parkingNotes) ||
    (PEERIFY_BOOKING_ENQUIRIES_ENABLED && profile.bookingEnquiriesEnabled === true) ||
    Boolean(profile.minimumFee) ||
    Boolean(profile.doorSplit) ||
    Boolean(profile.houseCut) ||
    (Boolean(profile.peerifyFeeCoveredBy) && profile.peerifyFeeCoveredBy !== "not_specified") ||
    Boolean(profile.availableDays) ||
    Boolean(profile.typicalResponseTime) ||
    Boolean(profile.bookingNote) ||
    profile.greenRoom === true ||
    profile.merchTable === true ||
    Boolean(profile.foodDrink) ||
    Boolean(profile.accommodationHelp) ||
    Boolean(profile.localTransportHelp) ||
    Boolean(profile.guestListPolicy) ||
    Boolean(profile.houseRules) ||
    Boolean(profile.soundCurfew) ||
    Boolean(profile.cancellationPolicy) ||
    Boolean(profile.safetyPolicy);

const formatArtistName = (circle?: Partial<Circle> | null): string => asString(circle?.name) || "Unknown artist";

const formatBulletLines = (items: string[]): string =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None specified";

const withFallback = (value: string | undefined, fallback = "Not specified"): string => {
    const nextValue = asString(value);
    return nextValue || fallback;
};

export const formatPeerifyPledgeEnquiryMessage = (
    circle: Partial<Circle> | null | undefined,
    enquiry: PeerifyPledgeEnquiryInput,
): string => {
    const helpOptions = asStringArray(enquiry.helpOptions);
    return [
        "Peerify pledge enquiry",
        "",
        "This is a non-binding pledge of interest, not a ticket purchase.",
        "",
        `Artist: ${formatArtistName(circle)}`,
        `Fan location: ${withFallback(enquiry.fanLocation)}`,
        `Maximum ticket amount: ${withFallback(enquiry.maximumTicketAmount)}`,
        `Preferred event type: ${withFallback(enquiry.preferredEventType)}`,
        "Can help with:",
        formatBulletLines(helpOptions),
        ...(helpOptions.includes("Host")
            ? [`Approximate hosting capacity: ${withFallback(enquiry.hostingCapacity)}`]
            : []),
        "",
        `Note: ${withFallback(enquiry.note, "None")}`,
    ].join("\n");
};

export const formatPeerifyBookingEnquiryMessage = (
    circle: Partial<Circle> | null | undefined,
    enquiry: PeerifyBookingEnquiryInput,
): string => {
    const supportLines = [
        `Accommodation: ${enquiry.accommodationAvailable ? "yes" : "no"}`,
        `Local transport: ${enquiry.localTransportAvailable ? "yes" : "no"}`,
        `Food / hospitality: ${enquiry.foodHospitalityAvailable ? "yes" : "no"}`,
        `Sound equipment: ${enquiry.soundEquipmentAvailable ? "yes" : "no"}`,
    ];

    return [
        "Peerify booking enquiry",
        "",
        "This is a booking enquiry only. It is not a confirmed booking or agreement.",
        "",
        `Artist: ${formatArtistName(circle)}`,
        `Booker location: ${withFallback(enquiry.bookerLocation)}`,
        `Event type: ${withFallback(enquiry.eventType)}`,
        `Expected audience size: ${withFallback(enquiry.expectedAudienceSize)}`,
        `Possible date/date range: ${withFallback(enquiry.possibleDateRange)}`,
        `Setting: ${withFallback(enquiry.setting)}`,
        "",
        "Available support:",
        formatBulletLines(supportLines),
        "",
        `Message: ${withFallback(enquiry.message, "None")}`,
    ].join("\n");
};
