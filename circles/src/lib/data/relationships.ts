import { ObjectId } from "mongodb";
import { Circle } from "@/models/models";
import { ChatConversations, ChatMessageDocs, Circles, Members, UserRelationships } from "./db";

const CONNECT_STATUS_VALUES = ["none", "pending_sent", "pending_received", "accepted"] as const;
const DM_PERMISSION_VALUES = ["none", "allowed"] as const;
const DM_PERMISSION_SOURCE_VALUES = ["none", "contact", "legacy_dm", "recipient_setting"] as const;

export type RelationshipConnectStatus = (typeof CONNECT_STATUS_VALUES)[number];
export type RelationshipDmPermission = (typeof DM_PERMISSION_VALUES)[number];
export type RelationshipDmPermissionSource = (typeof DM_PERMISSION_SOURCE_VALUES)[number];

export type RelationshipEdge = {
    _id?: any;
    fromDid: string;
    toDid: string;
    isFollowing: boolean;
    connectStatus: RelationshipConnectStatus;
    dmPermission: RelationshipDmPermission;
    dmPermissionSource: RelationshipDmPermissionSource;
    // Set on the requester's edge when the other person declines. The edge stays pending_sent, so
    // the requester keeps seeing "Requested" until the cooldown ends. Never sent to the client.
    declinedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
};

// After a decline the requester can't send that person a new request for this long.
export const CONNECTION_REQUEST_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export const isWithinConnectionCooldown = (edge?: Pick<RelationshipEdge, "declinedAt"> | null, now = new Date()) =>
    !!edge?.declinedAt && now.getTime() - edge.declinedAt.getTime() < CONNECTION_REQUEST_COOLDOWN_MS;

// The status the requester sees: a declined request reads as pending until the cooldown ends,
// then as none, so they get Connect back without being told they were declined.
export const getEffectiveConnectStatus = (edge?: RelationshipEdge | null, now = new Date()): RelationshipConnectStatus => {
    if (!edge) {
        return "none";
    }
    if (edge.connectStatus === "pending_sent" && edge.declinedAt && !isWithinConnectionCooldown(edge, now)) {
        return "none";
    }
    return edge.connectStatus;
};

export type DmEligibility = {
    isAllowed: boolean;
    existingConversationId?: string;
    hasExistingConversation: boolean;
    dmPermission: RelationshipDmPermission;
    dmPermissionSource: RelationshipDmPermissionSource;
    reason: DmEligibilityReason;
    relationshipEdge: RelationshipEdge | null;
};

// Why a DM is (not) allowed. existing_dm_history is the legacy exception: a two-person DM that
// already had a message before LEGACY_DM_CUTOFF.
export type DmEligibilityReason =
    | "self"
    | "existing_dm_history"
    | "dm_permission_contact"
    | "dm_permission_recipient_setting"
    | "dm_permission_conversation_grant"
    | "dm_not_allowed";

export type ProfileRelationshipState = {
    viewerDid: string;
    targetDid: string;
    isFollowing: boolean;
    connectStatus: RelationshipConnectStatus;
    dmAllowed: boolean;
    dmPermissionSource: RelationshipDmPermissionSource;
    hasExistingDm: boolean;
    showMessage: boolean;
    showConnect: boolean;
    connectLabel: "Connect" | "Requested" | "Requested You" | null;
    messageVisibilityReason: DmEligibilityReason;
    connectLabelReason:
        | "pending_sent"
        | "pending_received"
        | "contact_not_established"
        | "contact_established";
};

export type ToolboxConnectionStatus = Extract<RelationshipConnectStatus, "accepted" | "pending_sent" | "pending_received">;

export type ToolboxConnection = {
    circle: Circle;
    connectStatus: ToolboxConnectionStatus;
    updatedAt: Date;
};

export type ToolboxConnectionsSummary = {
    accepted: ToolboxConnection[];
    pendingIncoming: ToolboxConnection[];
    pendingOutgoing: ToolboxConnection[];
};

UserRelationships?.createIndex({ fromDid: 1, toDid: 1 }, { unique: true });
UserRelationships?.createIndex({ fromDid: 1, updatedAt: -1 });
UserRelationships?.createIndex({ toDid: 1, connectStatus: 1 });

const normalizeConnectStatus = (value?: unknown): RelationshipConnectStatus =>
    CONNECT_STATUS_VALUES.includes(value as RelationshipConnectStatus) ? (value as RelationshipConnectStatus) : "none";

const normalizeDmPermission = (value?: unknown): RelationshipDmPermission =>
    DM_PERMISSION_VALUES.includes(value as RelationshipDmPermission) ? (value as RelationshipDmPermission) : "none";

const normalizeDmPermissionSource = (value?: unknown): RelationshipDmPermissionSource =>
    DM_PERMISSION_SOURCE_VALUES.includes(value as RelationshipDmPermissionSource)
        ? (value as RelationshipDmPermissionSource)
        : "none";

const normalizeRelationshipEdge = (edge: any): RelationshipEdge => ({
    _id: edge?._id,
    fromDid: String(edge?.fromDid || ""),
    toDid: String(edge?.toDid || ""),
    isFollowing: edge?.isFollowing === true,
    connectStatus: normalizeConnectStatus(edge?.connectStatus),
    dmPermission: normalizeDmPermission(edge?.dmPermission),
    dmPermissionSource: normalizeDmPermissionSource(edge?.dmPermissionSource),
    ...(edge?.declinedAt ? { declinedAt: new Date(edge.declinedAt) } : {}),
    createdAt: edge?.createdAt instanceof Date ? edge.createdAt : new Date(edge?.createdAt || Date.now()),
    updatedAt: edge?.updatedAt instanceof Date ? edge.updatedAt : new Date(edge?.updatedAt || Date.now()),
});

const buildDefaultRelationshipEdge = (fromDid: string, toDid: string, now: Date): RelationshipEdge => ({
    fromDid,
    toDid,
    isFollowing: false,
    connectStatus: "none",
    dmPermission: "none",
    dmPermissionSource: "none",
    createdAt: now,
    updatedAt: now,
});

const buildRelationshipEdgeInsertFields = (fromDid: string, toDid: string, now: Date) => ({
    fromDid,
    toDid,
    connectStatus: "none" as const,
    dmPermission: "none" as const,
    dmPermissionSource: "none" as const,
    createdAt: now,
});

const isStrongerDmPermissionSource = (source: RelationshipDmPermissionSource): boolean =>
    source === "contact" || source === "recipient_setting";

const getConnectLabel = (
    connectStatus: RelationshipConnectStatus,
): "Connect" | "Requested" | "Requested You" | null => {
    if (connectStatus === "pending_sent") {
        return "Requested";
    }
    if (connectStatus === "pending_received") {
        return "Requested You";
    }
    if (connectStatus === "accepted") {
        return null;
    }
    return "Connect";
};

const findExistingDmConversationId = async (
    didA: string,
    didB: string,
    requireMessageHistory: boolean,
): Promise<string | undefined> => {
    const conversation = await ChatConversations.findOne(
        {
            type: "dm",
            participants: { $all: [didA, didB] },
            archived: { $ne: true },
        },
        {
            projection: {
                _id: 1,
                participants: 1,
            },
        },
    );

    if (!conversation?._id) {
        return undefined;
    }

    const participants = Array.from(
        new Set(
            ((conversation as any).participants || []).filter(
                (participantDid: unknown): participantDid is string =>
                    typeof participantDid === "string" && participantDid.length > 0,
            ),
        ),
    );
    if (participants.length !== 2 || !participants.includes(didA) || !participants.includes(didB)) {
        return undefined;
    }

    const conversationId = String(conversation._id);
    if (!requireMessageHistory) {
        return conversationId;
    }

    const existingMessage = await ChatMessageDocs.findOne(
        { conversationId },
        {
            projection: { _id: 1 },
        },
    );

    return existingMessage?._id ? conversationId : undefined;
};

const isFollowingUser = async (viewerDid: string, targetDid: string): Promise<boolean> => {
    if (!viewerDid || !targetDid || viewerDid === targetDid) {
        return false;
    }

    const targetCircle = await Circles.findOne(
        { did: targetDid, circleType: "user" },
        {
            projection: { _id: 1 },
        },
    );
    if (!targetCircle?._id) {
        return false;
    }

    const membership = await Members.findOne({
        userDid: viewerDid,
        circleId: String(targetCircle._id),
    });

    return !!membership;
};

export const getRelationshipEdge = async (fromDid: string, toDid: string): Promise<RelationshipEdge | null> => {
    if (!fromDid || !toDid) {
        return null;
    }

    const edge = await UserRelationships.findOne({ fromDid, toDid });
    return edge ? normalizeRelationshipEdge(edge) : null;
};

export const upsertFollowState = async (fromDid: string, toDid: string, isFollowing: boolean): Promise<void> => {
    if (!fromDid || !toDid || fromDid === toDid) {
        return;
    }

    const now = new Date();
    await UserRelationships.updateOne(
        { fromDid, toDid },
        {
            $set: {
                isFollowing,
                updatedAt: now,
            },
            $setOnInsert: buildRelationshipEdgeInsertFields(fromDid, toDid, now),
        },
        { upsert: true },
    );
};

const upsertLegacyDmPermissionEdge = async (fromDid: string, toDid: string): Promise<number> => {
    const existing = await getRelationshipEdge(fromDid, toDid);
    const now = new Date();

    if (!existing) {
        const edge = buildDefaultRelationshipEdge(fromDid, toDid, now);
        edge.dmPermission = "allowed";
        edge.dmPermissionSource = "legacy_dm";
        await UserRelationships.insertOne(edge);
        return 1;
    }

    if (isStrongerDmPermissionSource(existing.dmPermissionSource)) {
        return 0;
    }

    const shouldSetPermission = existing.dmPermission !== "allowed";
    const shouldSetSource = existing.dmPermissionSource !== "legacy_dm";

    if (!shouldSetPermission && !shouldSetSource) {
        return 0;
    }

    await UserRelationships.updateOne(
        { fromDid, toDid },
        {
            $set: {
                ...(shouldSetPermission ? { dmPermission: "allowed" as const } : {}),
                ...(shouldSetSource ? { dmPermissionSource: "legacy_dm" as const } : {}),
                updatedAt: now,
            },
        },
    );

    return 1;
};

export const upsertLegacyDmPermissionPair = async (didA: string, didB: string): Promise<number> => {
    if (!didA || !didB || didA === didB) {
        return 0;
    }

    let touchedEdges = 0;
    touchedEdges += await upsertLegacyDmPermissionEdge(didA, didB);
    touchedEdges += await upsertLegacyDmPermissionEdge(didB, didA);
    return touchedEdges;
};

// New DMs need an accepted connection (or the recipient's own setting), or a server-verified
// grant on the conversation (pledge, crew or enquiry; see DmGrant). The other exception is
// legacy: a two-person DM whose first message is before LEGACY_DM_CUTOFF (the prod deploy time
// of this rule) keeps working. Conversations created empty by the old profile "Message" button
// don't count. Read only: this never writes, unlike the old version, which upserted legacy_dm
// permission on every call. The stored legacy_dm fields are no longer consulted.
let warnedMissingLegacyDmCutoff = false;
export const getLegacyDmCutoff = (): Date | null => {
    const raw = process.env.LEGACY_DM_CUTOFF;
    const cutoff = raw ? new Date(raw) : null;
    if (cutoff && !Number.isNaN(cutoff.getTime())) {
        return cutoff;
    }
    if (!warnedMissingLegacyDmCutoff) {
        warnedMissingLegacyDmCutoff = true;
        console.warn("LEGACY_DM_CUTOFF is unset or invalid: any two-person DM with a message counts as legacy");
    }
    return null;
};

// conversationId -> createdAt of its first message, for the given conversations.
const getFirstMessageTimes = async (conversationIds: string[]): Promise<Map<string, Date>> => {
    if (conversationIds.length === 0) {
        return new Map();
    }
    const rows = await ChatMessageDocs.aggregate([
        { $match: { conversationId: { $in: conversationIds } } },
        { $group: { _id: "$conversationId", first: { $min: "$createdAt" } } },
    ]).toArray();
    return new Map(rows.map((row: any) => [String(row._id), new Date(row.first)]));
};

const hasDmGrant = async (conversationId: string): Promise<boolean> => {
    if (!ObjectId.isValid(conversationId)) {
        return false;
    }
    const conversation = await ChatConversations.findOne(
        { _id: new ObjectId(conversationId), "dmGrants.0": { $exists: true } },
        { projection: { _id: 1 } },
    );
    return !!conversation;
};

const isLegacyFirstMessage = (first: Date | undefined, cutoff: Date | null): boolean =>
    !!first && (!cutoff || first.getTime() < cutoff.getTime());

export const getDmEligibility = async (viewerDid: string, targetDid: string): Promise<DmEligibility> => {
    if (!viewerDid || !targetDid || viewerDid === targetDid) {
        return {
            isAllowed: false,
            hasExistingConversation: false,
            dmPermission: "none",
            dmPermissionSource: "none",
            reason: "self",
            relationshipEdge: null,
        };
    }

    const [relationshipEdge, existingConversationId] = await Promise.all([
        getRelationshipEdge(viewerDid, targetDid),
        findExistingDmConversationId(viewerDid, targetDid, false),
    ]);
    const base = {
        existingConversationId,
        hasExistingConversation: !!existingConversationId,
        dmPermission: relationshipEdge?.dmPermission || ("none" as const),
        dmPermissionSource: relationshipEdge?.dmPermissionSource || ("none" as const),
        relationshipEdge,
    };

    if (relationshipEdge?.connectStatus === "accepted") {
        return { ...base, isAllowed: true, reason: "dm_permission_contact" };
    }

    if (relationshipEdge?.dmPermission === "allowed" && relationshipEdge.dmPermissionSource === "recipient_setting") {
        return { ...base, isAllowed: true, reason: "dm_permission_recipient_setting" };
    }

    if (existingConversationId && (await hasDmGrant(existingConversationId))) {
        return { ...base, isAllowed: true, reason: "dm_permission_conversation_grant" };
    }

    if (existingConversationId) {
        const firstMessageAt = (await getFirstMessageTimes([existingConversationId])).get(existingConversationId);
        if (isLegacyFirstMessage(firstMessageAt, getLegacyDmCutoff())) {
            return { ...base, isAllowed: true, reason: "existing_dm_history" };
        }
    }

    return { ...base, isAllowed: false, reason: "dm_not_allowed" };
};

// The DIDs in targetDids that userDid could not start a DM with. Group chats use it: a creator
// (or an admin adding people later) must pass the DM rule with every participant they add.
export const listDidsFailingDmRule = async (userDid: string, targetDids: string[]): Promise<string[]> => {
    const uniqueTargets = Array.from(new Set(targetDids.filter((did) => did && did !== userDid)));
    const results = await Promise.all(uniqueTargets.map((did) => getDmEligibility(userDid, did)));
    return uniqueTargets.filter((_, index) => !results[index].isAllowed);
};

export const getProfileRelationshipState = async (
    viewerDid: string,
    targetDid: string,
): Promise<ProfileRelationshipState> => {
    const [dmEligibility, relationshipEdge, following] = await Promise.all([
        getDmEligibility(viewerDid, targetDid),
        getRelationshipEdge(viewerDid, targetDid),
        isFollowingUser(viewerDid, targetDid),
    ]);

    const isFollowing = following || relationshipEdge?.isFollowing === true;
    const connectStatus = getEffectiveConnectStatus(relationshipEdge);
    const dmAllowed = dmEligibility.isAllowed;

    return {
        viewerDid,
        targetDid,
        isFollowing,
        connectStatus,
        dmAllowed,
        dmPermissionSource: dmEligibility.dmPermissionSource,
        hasExistingDm: dmEligibility.hasExistingConversation,
        showMessage: dmAllowed,
        // Connect shows whatever the DM state: a grandfathered pair who can still message gets
        // Message and Connect side by side.
        showConnect: connectStatus !== "accepted",
        connectLabel: getConnectLabel(connectStatus),
        messageVisibilityReason: dmEligibility.reason,
        connectLabelReason:
            connectStatus === "pending_sent"
                ? "pending_sent"
                : connectStatus === "pending_received"
                  ? "pending_received"
                  : connectStatus === "accepted"
                    ? "contact_established"
                    : "contact_not_established",
    };
};

// People the user can start or continue a DM with today: accepted connections, recipient-setting
// permissions, and partners in a legacy DM (see getDmEligibility).
export const listDmEligibleContactsForUserDid = async (userDid: string): Promise<Circle[]> => {
    if (!userDid) {
        return [];
    }

    const contactDids = new Set<string>();

    const relationshipEdges = await UserRelationships.find(
        {
            fromDid: userDid,
            $or: [{ connectStatus: "accepted" }, { dmPermission: "allowed", dmPermissionSource: "recipient_setting" }],
        },
        {
            projection: { toDid: 1 },
        },
    ).toArray();

    for (const edge of relationshipEdges) {
        if (typeof edge?.toDid === "string" && edge.toDid !== userDid) {
            contactDids.add(edge.toDid);
        }
    }

    const dmConversations = await ChatConversations.find(
        {
            type: "dm",
            participants: userDid,
            archived: { $ne: true },
        },
        {
            projection: { participants: 1, dmGrants: 1 },
        },
    ).toArray();

    const otherDidByConversationId = new Map<string, string>();
    for (const conversation of dmConversations) {
        const participants: string[] = Array.from(
            new Set(
                ((conversation as any)?.participants || []).filter(
                    (did: unknown): did is string => typeof did === "string" && did.length > 0,
                ),
            ),
        );
        const otherDid = participants.find((did) => did !== userDid);
        if (participants.length !== 2 || !otherDid || contactDids.has(otherDid)) {
            continue;
        }
        if (Array.isArray((conversation as any)?.dmGrants) && (conversation as any).dmGrants.length > 0) {
            contactDids.add(otherDid);
        } else {
            otherDidByConversationId.set(String(conversation._id), otherDid);
        }
    }

    const firstMessageTimes = await getFirstMessageTimes(Array.from(otherDidByConversationId.keys()));
    const cutoff = getLegacyDmCutoff();
    otherDidByConversationId.forEach((otherDid, conversationId) => {
        if (isLegacyFirstMessage(firstMessageTimes.get(conversationId), cutoff)) {
            contactDids.add(otherDid);
        }
    });

    if (contactDids.size === 0) {
        return [];
    }

    const circles = await Circles.find(
        {
            did: { $in: Array.from(contactDids) },
            circleType: "user",
        },
        {
            projection: {
                _id: 1,
                did: 1,
                handle: 1,
                name: 1,
                picture: 1,
                circleType: 1,
            },
        },
    )
        .sort({ name: 1 })
        .toArray();

    return circles.map((circle: any) => ({
        ...circle,
        _id: circle?._id ? String(circle._id) : circle?._id,
    }));
};

export const listAcceptedToolboxConnectionsForUserDid = async (userDid: string): Promise<Circle[]> => {
    if (!userDid) {
        return [];
    }

    const acceptedConnectionDids = Array.from(
        new Set(
            (
                await UserRelationships.find(
                    {
                        fromDid: userDid,
                        connectStatus: "accepted",
                    },
                    {
                        projection: { toDid: 1 },
                    },
                ).toArray()
            )
                .map((edge) => (typeof edge?.toDid === "string" ? edge.toDid : ""))
                .filter((did): did is string => did.length > 0 && did !== userDid),
        ),
    );

    if (acceptedConnectionDids.length === 0) {
        return [];
    }

    const circles = await Circles.find(
        {
            did: { $in: acceptedConnectionDids },
            circleType: "user",
        },
        {
            projection: {
                _id: 1,
                did: 1,
                handle: 1,
                name: 1,
                picture: 1,
                description: 1,
                mission: 1,
                circleType: 1,
            },
        },
    )
        .sort({ name: 1 })
        .toArray();

    return circles.map((circle: any) => ({
        ...circle,
        _id: circle?._id ? String(circle._id) : circle?._id,
    }));
};

export const listToolboxConnectionsForUserDid = async (userDid: string): Promise<ToolboxConnectionsSummary> => {
    if (!userDid) {
        return {
            accepted: [],
            pendingIncoming: [],
            pendingOutgoing: [],
        };
    }

    const rawRelationshipEdges = await UserRelationships.find(
        {
            fromDid: userDid,
            connectStatus: { $in: ["accepted", "pending_sent", "pending_received"] },
        },
        {
            projection: {
                toDid: 1,
                connectStatus: 1,
                declinedAt: 1,
                updatedAt: 1,
            },
        },
    ).toArray();
    const now = new Date();
    const relationshipEdges = rawRelationshipEdges.filter(
        (edge) => getEffectiveConnectStatus(normalizeRelationshipEdge(edge), now) !== "none",
    );

    if (relationshipEdges.length === 0) {
        return {
            accepted: [],
            pendingIncoming: [],
            pendingOutgoing: [],
        };
    }

    const circles = await Circles.find(
        {
            did: {
                $in: Array.from(
                    new Set(
                        relationshipEdges
                            .map((edge) => (typeof edge?.toDid === "string" ? edge.toDid : ""))
                            .filter((did): did is string => did.length > 0 && did !== userDid),
                    ),
                ),
            },
            circleType: "user",
        },
        {
            projection: {
                _id: 1,
                did: 1,
                handle: 1,
                name: 1,
                picture: 1,
                description: 1,
                mission: 1,
                circleType: 1,
            },
        },
    ).toArray();

    const circleByDid = new Map(
        circles.map((circle: any) => [
            circle.did,
            {
                ...circle,
                _id: circle?._id ? String(circle._id) : circle?._id,
            } as Circle,
        ]),
    );

    const summary: ToolboxConnectionsSummary = {
        accepted: [],
        pendingIncoming: [],
        pendingOutgoing: [],
    };

    for (const edge of relationshipEdges) {
        if (typeof edge?.toDid !== "string") {
            continue;
        }

        const circle = circleByDid.get(edge.toDid);
        if (!circle) {
            continue;
        }

        const connection: ToolboxConnection = {
            circle,
            connectStatus: edge.connectStatus as ToolboxConnectionStatus,
            updatedAt: edge?.updatedAt instanceof Date ? edge.updatedAt : new Date(edge?.updatedAt || Date.now()),
        };

        if (connection.connectStatus === "accepted") {
            summary.accepted.push(connection);
        } else if (connection.connectStatus === "pending_received") {
            summary.pendingIncoming.push(connection);
        } else {
            summary.pendingOutgoing.push(connection);
        }
    }

    summary.accepted.sort((a, b) => (a.circle.name || "").localeCompare(b.circle.name || ""));
    summary.pendingIncoming.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    summary.pendingOutgoing.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return summary;
};

const getAcceptedConnectionCirclesForUserDid = async (userDid: string): Promise<Circle[]> => {
    if (!userDid) {
        return [];
    }

    const relationshipEdges = await UserRelationships.find(
        {
            fromDid: userDid,
            connectStatus: "accepted",
        },
        {
            projection: {
                toDid: 1,
            },
        },
    ).toArray();

    const acceptedDids = Array.from(
        new Set(
            relationshipEdges
                .map((edge) => (typeof edge?.toDid === "string" ? edge.toDid : ""))
                .filter((did): did is string => did.length > 0 && did !== userDid),
        ),
    );

    if (acceptedDids.length === 0) {
        return [];
    }

    const circles = await Circles.find(
        {
            did: { $in: acceptedDids },
            circleType: "user",
        },
        {
            projection: {
                _id: 1,
                did: 1,
                handle: 1,
                name: 1,
                picture: 1,
                description: 1,
                mission: 1,
                circleType: 1,
            },
        },
    )
        .sort({ name: 1 })
        .toArray();

    return circles.map((circle: any) => ({
        ...circle,
        _id: circle?._id ? String(circle._id) : circle?._id,
    }));
};

export const listAcceptedConnectionsForUserDid = async (userDid: string): Promise<Circle[]> =>
    getAcceptedConnectionCirclesForUserDid(userDid);

export const searchAcceptedConnectionsForUserDid = async (
    userDid: string,
    query: string,
    limit: number = 10,
): Promise<Circle[]> => {
    const connections = await getAcceptedConnectionCirclesForUserDid(userDid);
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = connections.filter((connection) => {
        if (!normalizedQuery) return true;
        const nameMatch = connection.name?.toLowerCase().includes(normalizedQuery);
        const handleMatch = connection.handle?.toLowerCase().includes(normalizedQuery);
        return !!(nameMatch || handleMatch);
    });

    return filtered.slice(0, limit);
};

export const isAcceptedConnectionForUserDid = async (userDid: string, targetDid: string): Promise<boolean> => {
    if (!userDid || !targetDid || userDid === targetDid) {
        return false;
    }

    const edge = await UserRelationships.findOne(
        {
            fromDid: userDid,
            toDid: targetDid,
            connectStatus: "accepted",
        },
        {
            projection: { _id: 1 },
        },
    );

    return !!edge;
};

export const migrateLegacyDmRelationships = async ({
    apply,
    limit,
}: {
    apply: boolean;
    limit?: number;
}): Promise<{
    scannedConversations: number;
    skippedWithoutHistory: number;
    skippedInvalidParticipants: number;
    touchedEdges: number;
}> => {
    const cursor = ChatConversations.find(
        {
            type: "dm",
            archived: { $ne: true },
        },
        {
            projection: {
                _id: 1,
                participants: 1,
            },
        },
    );

    let scannedConversations = 0;
    let skippedWithoutHistory = 0;
    let skippedInvalidParticipants = 0;
    let touchedEdges = 0;

    for await (const conversation of cursor) {
        if (typeof limit === "number" && scannedConversations >= limit) {
            break;
        }

        scannedConversations += 1;

        const participants: string[] = Array.from(
            new Set(
                ((conversation as any)?.participants || []).filter(
                    (participantDid: unknown): participantDid is string =>
                        typeof participantDid === "string" && participantDid.length > 0,
                ),
            ),
        );

        if (participants.length !== 2) {
            skippedInvalidParticipants += 1;
            continue;
        }

        const hasHistory = await findExistingDmConversationId(participants[0], participants[1], true);
        if (!hasHistory) {
            skippedWithoutHistory += 1;
            continue;
        }

        if (apply) {
            touchedEdges += await upsertLegacyDmPermissionPair(participants[0], participants[1]);
        } else {
            touchedEdges += 2;
        }
    }

    return {
        scannedConversations,
        skippedWithoutHistory,
        skippedInvalidParticipants,
        touchedEdges,
    };
};
