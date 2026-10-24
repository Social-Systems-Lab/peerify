// Pop-up and private spaces (collection "spaces"; see the Spaces comment in models.ts). Every read
// and write here is scoped in the query itself: an owner function filters on { _id, ownerDid } (and
// type, on update), so another person's id simply matches nothing, and there is no lookup by _id
// alone. Input always arrives through parseSpaceInput
// (lib/spaces/space-rules.ts), which already rounded a private space's location.
//
// No discovery path (circle queries, search, map feeds, the vector index) reads this collection.

import { ObjectId } from "mongodb";
import { Circles, Spaces } from "./db";
import { SpaceDoc, SpaceInput, SpaceType } from "@/models/models";
import { canPerformRestrictedAction } from "@/lib/auth/verification";

export const SPACES_PER_PERSON_MAX = 10;

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
    listeningRuleAcceptedAt: 1,
    hostResponsibilityAcceptedAt: 1,
    createdAt: 1,
    updatedAt: 1,
} as const;

// Optional fields per type: cleared with $unset when an edit leaves them empty.
const OPTIONAL_FIELDS: Record<SpaceType, string[]> = {
    popup: ["noiseLimits"],
    private: ["noiseCurfew", "notesForPeerify"],
};

// What the browser gets: ids and dates as strings.
export type SpaceView = Omit<
    SpaceDoc,
    "_id" | "listeningRuleAcceptedAt" | "hostResponsibilityAcceptedAt" | "createdAt" | "updatedAt"
> & {
    _id: string;
    listeningRuleAcceptedAt: string;
    hostResponsibilityAcceptedAt: string;
    createdAt: string;
    updatedAt: string;
};

const toIso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value ?? ""));

export const toSpaceView = (doc: SpaceDoc): SpaceView =>
    ({
        ...doc,
        _id: String(doc._id),
        listeningRuleAcceptedAt: toIso(doc.listeningRuleAcceptedAt),
        hostResponsibilityAcceptedAt: toIso(doc.hostResponsibilityAcceptedAt),
        createdAt: toIso(doc.createdAt),
        updatedAt: toIso(doc.updatedAt),
    }) as SpaceView;

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

export const listSpacesForOwner = async (ownerDid: string): Promise<SpaceView[]> => {
    const docs = (await Spaces.find({ ownerDid }, { projection: SPACE_PROJECTION })
        .sort({ createdAt: 1 })
        .toArray()) as SpaceDoc[];
    return docs.map(toSpaceView);
};

export type CreateSpaceResult = { ok: true; id: string } | { ok: false; reason: "limit" };

// The cap is checked before the insert, so two saves at the same moment could both pass; a person
// racing themselves to an 11th space isn't worth a transaction.
export const createSpaceForOwner = async (ownerDid: string, input: SpaceInput): Promise<CreateSpaceResult> => {
    const count = await Spaces.countDocuments({ ownerDid });
    if (count >= SPACES_PER_PERSON_MAX) {
        return { ok: false, reason: "limit" };
    }
    const now = new Date();
    const doc = {
        ...toStoredFields(input),
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
export const updateSpaceForOwner = async (ownerDid: string, spaceId: string, input: SpaceInput): Promise<boolean> => {
    const _id = toObjectId(spaceId);
    if (!_id) return false;
    const fields = toStoredFields(input) as Record<string, unknown>;
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

export const deleteSpaceForOwner = async (ownerDid: string, spaceId: string): Promise<boolean> => {
    const _id = toObjectId(spaceId);
    if (!_id) return false;
    const result = await Spaces.deleteOne({ _id, ownerDid });
    return result.deletedCount === 1;
};
