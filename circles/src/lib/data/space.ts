// Pop-up and private spaces (collection "spaces"; see the Spaces comment in models.ts). Every read
// and write here is scoped in the query itself: an owner function filters on { _id, ownerDid } (and
// type, on update), so another person's id simply matches nothing, and there is no lookup by _id
// alone. The only unscoped read is listAllSpacesForAdmin, which its one caller
// (lib/spaces/spaces-admin.ts) gates on the viewer being a platform admin. Input always arrives
// through parseSpaceInput (lib/spaces/space-rules.ts), which already rounded a private space's
// location.
//
// The only discovery path is getSpaceMapPins and getSpaceDetailsForMember below: private spaces
// whose owner put them on the map, and nothing else (no pop-ups, no owner, no notes). Circle
// queries, search and the vector index don't read this collection.
//
// A private space its owner puts on the map (publiclyListed) is the one place a picked point
// arrives: placePrivateSpaceLocation moves it by the owner's offerPinOffset before anything is
// stored, and only the moved point is kept.

import { ObjectId } from "mongodb";
import { Circles, Spaces } from "./db";
import { ensureOfferPinOffset, getPublishedCircleQuery } from "./circle";
import { FileInfo, Location, SpaceDoc, SpaceInput, SpaceMapPin, SpaceMemberDetails, SpaceType } from "@/models/models";
import { canPerformRestrictedAction } from "@/lib/auth/verification";
import { LngLat, SPACES_PER_PERSON_MAX } from "@/lib/spaces/space-rules";
import { OfferPinOffset, applyOfferPinOffset, isValidOfferPinOffset } from "@/lib/utils";

export { SPACES_PER_PERSON_MAX };

// Allow-list of stored fields. The same for owner and admin views: owners see everything they
// entered, including notesForPeerify.
const SPACE_PROJECTION = {
    _id: 1,
    type: 1,
    ownerDid: 1,
    name: 1,
    location: 1,
    capacity: 1,
    dealPreferences: 1,
    showTimes: 1,
    noiseLimits: 1,
    powerAvailable: 1,
    paAvailable: 1,
    setting: 1,
    amplification: 1,
    noiseCurfew: 1,
    stepFreeAccess: 1,
    notesForPeerify: 1,
    publiclyListed: 1,
    mapPinPlacedAt: 1,
    photos: 1,
    listeningRuleAcceptedAt: 1,
    hostResponsibilityAcceptedAt: 1,
    createdAt: 1,
    updatedAt: 1,
} as const;

// Optional fields per type: cleared with $unset when an edit leaves them empty.
const OPTIONAL_FIELDS: Record<SpaceType, string[]> = {
    popup: ["noiseLimits"],
    private: ["noiseCurfew", "notesForPeerify", "mapPinPlacedAt", "photos"],
};

// Omit that keeps the popup/private union, so code can still narrow on `type`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// What the browser gets: ids and dates as strings.
export type SpaceView = DistributiveOmit<
    SpaceDoc,
    "_id" | "listeningRuleAcceptedAt" | "hostResponsibilityAcceptedAt" | "createdAt" | "updatedAt" | "mapPinPlacedAt"
> & {
    _id: string;
    listeningRuleAcceptedAt: string;
    hostResponsibilityAcceptedAt: string;
    createdAt: string;
    updatedAt: string;
    mapPinPlacedAt?: string;
};

const toIso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value ?? ""));

export const toSpaceView = (doc: SpaceDoc): SpaceView => {
    const mapPinPlacedAt = doc.type === "private" ? doc.mapPinPlacedAt : undefined;
    return {
        ...doc,
        _id: String(doc._id),
        listeningRuleAcceptedAt: toIso(doc.listeningRuleAcceptedAt),
        hostResponsibilityAcceptedAt: toIso(doc.hostResponsibilityAcceptedAt),
        createdAt: toIso(doc.createdAt),
        updatedAt: toIso(doc.updatedAt),
        ...(mapPinPlacedAt ? { mapPinPlacedAt: toIso(mapPinPlacedAt) } : {}),
    } as SpaceView;
};

const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// The two checkboxes are stored as dates; the input's true/true flags aren't stored themselves.
const toStoredFields = (input: SpaceInput) => {
    const { listeningRuleAccepted: _listening, hostResponsibilityAccepted: _host, ...fields } = input;
    return fields;
};

// The signed-in person's own user row, narrowly: whether they're a platform admin and whether
// they may add spaces (the same verified-account gate as creating a venue identity).
export const getSpaceActor = async (
    did: string | undefined,
): Promise<{ did: string; isAdmin: boolean; canCreate: boolean } | null> => {
    if (!did) return null;
    const user = await Circles.findOne(
        { did, circleType: "user" },
        { projection: { did: 1, isAdmin: 1, isVerified: 1, verificationStatus: 1 } },
    );
    if (!user) return null;
    return { did, isAdmin: user.isAdmin === true, canCreate: canPerformRestrictedAction(user) };
};

// The owner's offerPinOffset, created if they have none yet: one offset per person, shared by
// their offer pins and their spaces' pins. Two different shifts of the same home would draw two
// rings around it that cross at only two points. Null when it can't be had (no user row, or a
// stored offset that isn't valid); the space then stays off the map.
const getOwnerPinOffset = async (ownerDid: string): Promise<OfferPinOffset | null> => {
    const owner = await Circles.findOne({ did: ownerDid, circleType: "user" }, { projection: { _id: 1, offerPinOffset: 1 } });
    if (!owner) return null;
    if (isValidOfferPinOffset(owner.offerPinOffset)) return owner.offerPinOffset;
    await ensureOfferPinOffset(String(owner._id));
    const again = await Circles.findOne({ _id: owner._id }, { projection: { offerPinOffset: 1 } });
    return isValidOfferPinOffset(again?.offerPinOffset) ? again.offerPinOffset : null;
};

const sameLngLat = (a: LngLat | undefined, b: LngLat): boolean => !!a && a.lng === b.lng && a.lat === b.lat;

type PlacedLocation = { location: Location; mapPinPlacedAt?: Date };

// What a private space stores as its location.
// - Not on the map: the rounded area from parseSpaceInput, and no mapPinPlacedAt.
// - On the map, and the form sent back the point it was given (the owner didn't pick again):
//   whatever is stored stays. That keeps an existing pin where it is, and keeps a space saved with
//   only its rounded area off the map until the owner picks their place.
// - On the map, newly picked: the picked point moved by the owner's offset, with the area names.
export const placePrivateSpaceLocation = async (
    ownerDid: string,
    input: Extract<SpaceInput, { type: "private" }>,
    pickedLngLat: LngLat | undefined,
    current?: SpaceDoc | null,
): Promise<PlacedLocation> => {
    if (!input.publiclyListed || !pickedLngLat) {
        return { location: input.location };
    }
    if (current?.type === "private" && sameLngLat(current.location?.lngLat, pickedLngLat)) {
        return current.mapPinPlacedAt
            ? { location: current.location, mapPinPlacedAt: current.mapPinPlacedAt }
            : { location: input.location };
    }
    const offset = await getOwnerPinOffset(ownerDid);
    if (!offset) {
        return { location: input.location };
    }
    return {
        location: { ...input.location, lngLat: applyOfferPinOffset(pickedLngLat, offset) },
        mapPinPlacedAt: new Date(),
    };
};

// The stored fields of a parsed input, with a private space's location placed.
const toPlacedFields = async (
    ownerDid: string,
    input: SpaceInput,
    pickedLngLat: LngLat | undefined,
    current?: SpaceDoc | null,
): Promise<Record<string, unknown>> => {
    const fields = toStoredFields(input) as Record<string, unknown>;
    if (input.type !== "private") return fields;
    const placed = await placePrivateSpaceLocation(ownerDid, input, pickedLngLat, current);
    return {
        ...fields,
        location: placed.location,
        ...(placed.mapPinPlacedAt ? { mapPinPlacedAt: placed.mapPinPlacedAt } : {}),
    };
};

export const listSpacesForOwner = async (ownerDid: string): Promise<SpaceView[]> => {
    const docs = (await Spaces.find({ ownerDid }, { projection: SPACE_PROJECTION })
        .sort({ createdAt: 1 })
        .toArray()) as SpaceDoc[];
    return docs.map(toSpaceView);
};

export type CreateSpaceResult = { ok: true; id: string } | { ok: false; reason: "limit" };

// The cap is checked before the insert, so two saves at the same moment could both pass; a person
// racing themselves to an 11th space isn't worth a transaction.
// spaceId: chosen by the caller when it has uploaded photos into that space's folder first.
// photos: private spaces only, already resolved (see the spaces actions).
export const createSpaceForOwner = async (
    ownerDid: string,
    input: SpaceInput,
    pickedLngLat?: LngLat,
    extras: { spaceId?: string; photos?: FileInfo[] } = {},
): Promise<CreateSpaceResult> => {
    const count = await Spaces.countDocuments({ ownerDid });
    if (count >= SPACES_PER_PERSON_MAX) {
        return { ok: false, reason: "limit" };
    }
    const now = new Date();
    const presetId = extras.spaceId ? toObjectId(extras.spaceId) : null;
    if (extras.spaceId && !presetId) throw new Error("Invalid space id");
    const photos = input.type === "private" && extras.photos?.length ? { photos: extras.photos } : {};
    const doc = {
        ...(presetId ? { _id: presetId } : {}),
        ...(await toPlacedFields(ownerDid, input, pickedLngLat)),
        ...photos,
        ownerDid,
        listeningRuleAcceptedAt: now,
        hostResponsibilityAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
    } as SpaceDoc;
    const result = await Spaces.insertOne(doc);
    return { ok: true, id: String(result.insertedId) };
};

// The type can't change on edit: the filter includes it, so a pop-up can't be turned into a
// private space (or back) with leftover fields of the other kind.
export const updateSpaceForOwner = async (
    ownerDid: string,
    spaceId: string,
    input: SpaceInput,
    pickedLngLat?: LngLat,
    // Private spaces: the full new list (empty removes them all). Left out, the stored photos are
    // removed too, so callers always pass it.
    photos?: FileInfo[],
): Promise<boolean> => {
    const _id = toObjectId(spaceId);
    if (!_id) return false;
    const current =
        input.type === "private" && pickedLngLat
            ? ((await Spaces.findOne({ _id, ownerDid, type: input.type }, { projection: SPACE_PROJECTION })) as SpaceDoc | null)
            : null;
    const fields = await toPlacedFields(ownerDid, input, pickedLngLat, current);
    if (input.type === "private" && photos?.length) fields.photos = photos;
    const unset = Object.fromEntries(
        OPTIONAL_FIELDS[input.type].filter((key) => fields[key] === undefined).map((key) => [key, ""]),
    );
    const result = await Spaces.updateOne(
        { _id, ownerDid, type: input.type },
        {
            $set: { ...fields, updatedAt: new Date() },
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
        },
    );
    return result.matchedCount === 1;
};

export const newSpaceId = (): string => String(new ObjectId());

// The owner's own space's photos, or null when it isn't theirs (or doesn't exist).
export const getSpacePhotosForOwner = async (ownerDid: string, spaceId: string): Promise<FileInfo[] | null> => {
    const _id = toObjectId(spaceId);
    if (!_id) return null;
    const doc = (await Spaces.findOne({ _id, ownerDid }, { projection: { _id: 1, photos: 1 } })) as {
        photos?: FileInfo[];
    } | null;
    return doc ? (doc.photos ?? []) : null;
};

export const deleteSpaceForOwner = async (ownerDid: string, spaceId: string): Promise<boolean> => {
    const _id = toObjectId(spaceId);
    if (!_id) return false;
    const result = await Spaces.deleteOne({ _id, ownerDid });
    return result.deletedCount === 1;
};

export type AdminSpaceRow = SpaceView & {
    owner: { name?: string; handle?: string; email?: string } | null;
};

// Platform admins only: the caller must have checked. Newest first, each with its owner's name,
// handle and email (admin-only, never logged).
export const listAllSpacesForAdmin = async (): Promise<AdminSpaceRow[]> => {
    const docs = (await Spaces.find({}, { projection: SPACE_PROJECTION }).sort({ createdAt: -1 }).toArray()) as SpaceDoc[];
    const ownerDids = Array.from(new Set(docs.map((doc) => doc.ownerDid)));
    const owners =
        ownerDids.length > 0
            ? await Circles.find(
                  { did: { $in: ownerDids }, circleType: "user" },
                  { projection: { did: 1, name: 1, handle: 1, email: 1 } },
              ).toArray()
            : [];
    const ownerByDid = new Map(owners.map((owner) => [owner.did, owner]));
    return docs.map((doc) => {
        const owner = ownerByDid.get(doc.ownerDid);
        return {
            ...toSpaceView(doc),
            owner: owner ? { name: owner.name, handle: owner.handle, email: owner.email } : null,
        };
    });
};

// On the map: a private space whose owner turned the switch on and that has its moved pin. A
// space with only its rounded area (saved before the switch existed, or with no offset) has no
// mapPinPlacedAt and never matches.
const ON_MAP_QUERY = { type: "private", publiclyListed: true, mapPinPlacedAt: { $exists: true } } as const;

// The owners of these spaces whose own profile is published: an unpublished or removed owner
// takes their spaces off the map with them.
const publishedOwnerDids = async (ownerDids: string[]): Promise<Set<string>> => {
    if (ownerDids.length === 0) return new Set();
    const owners = await Circles.find(
        { $and: [{ did: { $in: ownerDids }, circleType: "user" }, getPublishedCircleQuery()] },
        { projection: { did: 1 } },
    ).toArray();
    return new Set(owners.map((owner) => owner.did as string));
};

// Area names and the pin point only, rebuilt from an allow-list.
const toPinLocation = (location: Location): Location =>
    Object.fromEntries(
        Object.entries({
            precision: 2,
            country: location.country,
            countryCode: location.countryCode,
            region: location.region,
            city: location.city,
            lngLat: location.lngLat ? { lng: location.lngLat.lng, lat: location.lngLat.lat } : undefined,
        }).filter(([, value]) => value !== undefined && value !== ""),
    ) as unknown as Location;

// Map pins for every viewer, signed in or not. ownerDid is read to drop spaces of unpublished
// owners and never leaves this function.
export const getSpaceMapPins = async (): Promise<SpaceMapPin[]> => {
    const docs = (await Spaces.find(ON_MAP_QUERY, { projection: { _id: 1, ownerDid: 1, location: 1 } }).toArray()) as Pick<
        SpaceDoc,
        "_id" | "ownerDid" | "location"
    >[];
    const published = await publishedOwnerDids(Array.from(new Set(docs.map((doc) => doc.ownerDid))));
    return docs
        .filter((doc) => published.has(doc.ownerDid) && doc.location?.lngLat)
        .map((doc) => ({ _id: String(doc._id), spaceKind: "private" as const, location: toPinLocation(doc.location) }));
};

// One space's details for a signed-in viewer (the caller checks the sign-in), under the same gate
// as the pins, so an id of a space that isn't on the map reads nothing.
export const getSpaceDetailsForMember = async (spaceId: string): Promise<SpaceMemberDetails | null> => {
    const _id = toObjectId(spaceId);
    if (!_id) return null;
    const doc = (await Spaces.findOne(
        { ...ON_MAP_QUERY, _id },
        {
            projection: {
                _id: 1,
                ownerDid: 1,
                capacity: 1,
                setting: 1,
                amplification: 1,
                noiseCurfew: 1,
                stepFreeAccess: 1,
                dealPreferences: 1,
                photos: 1,
            },
        },
    )) as Extract<SpaceDoc, { type: "private" }> | null;
    if (!doc || !(await publishedOwnerDids([doc.ownerDid])).has(doc.ownerDid)) return null;
    return {
        _id: String(doc._id),
        capacity: doc.capacity,
        setting: doc.setting,
        amplification: doc.amplification,
        ...(doc.noiseCurfew ? { noiseCurfew: doc.noiseCurfew } : {}),
        stepFreeAccess: doc.stepFreeAccess,
        dealPreferences: doc.dealPreferences,
        photos: (doc.photos ?? []).map((photo) => ({ url: photo.url, originalName: photo.originalName })),
    };
};

// Whether this viewer may see this space photo (its /api/space-photo address): the space must
// still have it, and the viewer must be the owner, a platform admin, or (for a space on the map,
// of a published owner) any signed-in person.
export const canViewSpacePhoto = async (viewerDid: string | undefined, spaceId: string, url: string): Promise<boolean> => {
    const _id = toObjectId(spaceId);
    if (!viewerDid || !_id) return false;
    const doc = (await Spaces.findOne(
        { _id, type: "private", "photos.url": url },
        { projection: { _id: 1, ownerDid: 1, publiclyListed: 1, mapPinPlacedAt: 1 } },
    )) as (Pick<SpaceDoc, "ownerDid"> & { publiclyListed?: boolean; mapPinPlacedAt?: Date }) | null;
    if (!doc) return false;
    if (doc.ownerDid === viewerDid) return true;
    const viewer = await Circles.findOne({ did: viewerDid, circleType: "user" }, { projection: { isAdmin: 1 } });
    if (viewer?.isAdmin === true) return true;
    if (!viewer || doc.publiclyListed !== true || !doc.mapPinPlacedAt) return false;
    return (await publishedOwnerDids([doc.ownerDid])).has(doc.ownerDid);
};
