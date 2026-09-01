import { Collection, ObjectId } from "mongodb";
import { getDb } from "@/lib/data/db";
import type { Circle } from "@/models/models";
import { getPeerifyArtistProfile, type PeerifyPledgeEnquiryInput } from "@/lib/peerify/artist-profile";

export type PeerifyPledgeRecord = {
    _id?: string;
    artistCircleId: string;
    artistHandle: string;
    artistName: string;
    pledgerDid: string;
    pledgerName: string;
    pledgerHandle: string;
    pledgerPicture?: string;
    fanLocation: string;
    maximumTicketAmount: string;
    // Snapshot of the artist's booking-settings currency at the moment this pledge was made
    // (see pledge-dialog.tsx's `artistCurrency`) — absent on pledges created before this field
    // existed. Never re-derive it from the artist's *current* setting for a pledge that already
    // has one: the artist may change currencies later, and older pledges must keep the value
    // that was actually shown to the fan when they typed the number in.
    currency?: string;
    preferredEventType: string;
    helpOptions: string[];
    hostingCapacity: string;
    note: string;
    createdAt: Date;
    updatedAt: Date;
};

export type PeerifyPledgeInput = {
    artist: Circle;
    pledger: Circle;
    pledge: PeerifyPledgeEnquiryInput;
};

const COLLECTION_NAME = "peerify_pledges";

const clampText = (value: unknown, maxLength: number): string => {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim().slice(0, maxLength);
};

const clampStringArray = (value: unknown, maxItems: number, maxItemLength: number): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => clampText(item, maxItemLength))
        .filter(Boolean)
        .slice(0, maxItems);
};

type PledgeDoc = Omit<PeerifyPledgeRecord, "_id"> & { _id?: ObjectId };

// Ensured at most once per warm process (mirrors db.ts's own one-time PushSubscriptions index
// setup) rather than on every collection access — createIndex is idempotent but still a network
// round trip, and this collection isn't wired into db.ts's shared connect-time collection list.
// A DB-level backstop for the (artistCircleId, pledgerDid) uniqueness the upsert below already
// enforces at the application layer — so a future write path that bypasses createPeerifyPledge
// can't silently reintroduce duplicate pledges. If this fails (e.g. leftover duplicate data not
// yet cleaned up), it just logs and lets normal reads/writes continue; the app-level upsert logic
// doesn't depend on the index existing to behave correctly.
let pledgeIndexesEnsured = false;
const ensurePledgeIndexes = async (collection: Collection<PledgeDoc>): Promise<void> => {
    if (pledgeIndexesEnsured) {
        return;
    }
    pledgeIndexesEnsured = true;

    try {
        await collection.createIndex({ artistCircleId: 1, pledgerDid: 1 }, { unique: true });
    } catch (error) {
        console.error("Failed to ensure peerify_pledges unique index (artistCircleId, pledgerDid):", error);
    }
};

const getPledgeCollection = async () => {
    const db = await getDb();
    const collection = db.collection<PledgeDoc>(COLLECTION_NAME);
    await ensurePledgeIndexes(collection);
    return collection;
};

const mapPledgeRecord = (record: PledgeDoc): PeerifyPledgeRecord => ({
    ...record,
    _id: record._id?.toString(),
});

// One pledge per (artist, fan): a second pledge from the same fan to the same artist updates
// their existing record in place (fields overwritten wholesale, updatedAt bumped, createdAt and
// _id preserved) rather than creating a new row — the Pledge dialog now pre-fills from the fan's
// existing pledge (see getPeerifyPledgeForFan) precisely so a resubmit carries forward whatever
// they didn't touch this time, instead of this overwrite silently dropping it.
export async function createPeerifyPledge(input: PeerifyPledgeInput): Promise<PeerifyPledgeRecord> {
    const now = new Date();
    const artistCircleId = String(input.artist._id || "");
    const pledgerDid = clampText(input.pledger.did, 160);
    const fields: Omit<PeerifyPledgeRecord, "_id" | "createdAt"> = {
        artistCircleId,
        artistHandle: clampText(input.artist.handle, 80),
        artistName: clampText(input.artist.name, 160),
        pledgerDid,
        pledgerName: clampText(input.pledger.name, 160),
        pledgerHandle: clampText(input.pledger.handle, 80),
        pledgerPicture: clampText(input.pledger.picture?.url, 500) || undefined,
        fanLocation: clampText(input.pledge.fanLocation, 120),
        maximumTicketAmount: clampText(input.pledge.maximumTicketAmount, 80),
        currency: clampText(getPeerifyArtistProfile(input.artist).bookingSettings.currency, 10) || "EUR",
        preferredEventType: clampText(input.pledge.preferredEventType, 80),
        helpOptions: clampStringArray(input.pledge.helpOptions, 8, 80),
        hostingCapacity: clampText(input.pledge.hostingCapacity, 80),
        note: clampText(input.pledge.note, 1000),
        updatedAt: now,
    };

    const collection = await getPledgeCollection();
    const result = await collection.findOneAndUpdate(
        { artistCircleId, pledgerDid },
        { $set: fields, $setOnInsert: { createdAt: now } },
        { upsert: true, returnDocument: "after" },
    );

    if (!result) {
        throw new Error("Failed to save pledge");
    }

    return mapPledgeRecord(result);
}

export async function getPeerifyPledgeForFan(
    artistCircleId: string,
    pledgerDid: string,
): Promise<PeerifyPledgeRecord | null> {
    if (!artistCircleId || !pledgerDid) {
        return null;
    }

    const collection = await getPledgeCollection();
    const record = await collection.findOne({ artistCircleId, pledgerDid });

    return record ? mapPledgeRecord(record) : null;
}

export async function listPeerifyPledgesForArtist(artistCircleId: string): Promise<PeerifyPledgeRecord[]> {
    const collection = await getPledgeCollection();
    const records = await collection.find({ artistCircleId }).sort({ createdAt: -1 }).limit(500).toArray();

    return records.map(mapPledgeRecord);
}
