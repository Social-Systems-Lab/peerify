import { EventRsvps, Circles } from "./db";
import { ObjectId } from "mongodb";
import { EventRsvp, Circle } from "@/models/models";
import { IDENTITY_CIRCLE_PROJECTION } from "./circle";

/**
 * Get a user's RSVP for an event.
 */
export const getRsvp = async (eventId: string, userDid: string): Promise<EventRsvp | null> => {
    try {
        const rsvp = await EventRsvps.findOne({ eventId, userDid });
        if (rsvp) {
            (rsvp as any)._id = rsvp._id?.toString?.();
        }
        return (rsvp as EventRsvp) || null;
    } catch (error) {
        console.error("Error getting RSVP:", error);
        return null;
    }
};

/**
 * Upsert an RSVP for an event.
 */
export const upsertRsvp = async (
    eventId: string,
    circleId: string,
    userDid: string,
    status: "going" | "interested" | "cancelled" | "waitlist",
    selectedRoles?: string[],
    isPublic?: boolean,
    message?: string,
): Promise<boolean> => {
    try {
        const now = new Date();
        const update: any = {
            eventId,
            circleId,
            userDid,
            status,
            selectedRoles: selectedRoles || [],
            // default to true if not provided to preserve existing public behavior
            isPublic: typeof isPublic === "boolean" ? isPublic : true,
            updatedAt: now,
        };
        // No message removes the old one. Never $set it to undefined: without ignoreUndefined the driver
        // would store null.
        const trimmed = message?.trim();
        if (trimmed) update.message = trimmed;
        const result = await EventRsvps.updateOne(
            { eventId, userDid },
            { $set: update, ...(trimmed ? {} : { $unset: { message: "" } }), $setOnInsert: { createdAt: now } },
            { upsert: true },
        );
        return result.acknowledged === true;
    } catch (error) {
        console.error("Error upserting RSVP:", error);
        return false;
    }
};

/**
 * Cancel a user's RSVP (delete document).
 */
export const cancelRsvp = async (eventId: string, userDid: string): Promise<boolean> => {
    try {
        // Idempotent, same as upsertRsvp below: acknowledged means the write was accepted,
        // regardless of whether a document actually matched. A cancel on an already-cancelled
        // RSVP (e.g. a double-click race) has already reached the desired end state, so it
        // should report success, not "Failed to cancel RSVP".
        const result = await EventRsvps.deleteOne({ eventId, userDid });
        return result.acknowledged === true;
    } catch (error) {
        console.error("Error cancelling RSVP:", error);
        return false;
    }
};

/**
 * Get counts for each RSVP status.
 */
export const getEventAttendees = async (
    eventId: string,
): Promise<{ going: number; interested: number; waitlist: number; cancelled: number }> => {
    try {
        const agg = await EventRsvps.aggregate([
            { $match: { eventId } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]).toArray();

        const counts: Record<string, number> = {};
        agg.forEach((g) => {
            counts[g._id] = g.count;
        });

        return {
            going: counts["going"] || 0,
            interested: counts["interested"] || 0,
            waitlist: counts["waitlist"] || 0,
            cancelled: counts["cancelled"] || 0,
        };
    } catch (error) {
        console.error("Error getting attendee counts:", error);
        return { going: 0, interested: 0, waitlist: 0, cancelled: 0 };
    }
};

// One person on an event's guest list (event guests, 2026-11-20): identity fields only (name,
// handle, picture), their reply, their optional message to the organisers and when they last
// replied. Goes to the browser (getEventGuestsAction).
export type EventGuest = {
    user: Circle;
    status: "going" | "interested";
    message?: string;
    since?: Date;
};

/**
 * Everyone who clicked Attend or Interested on an event, earliest reply first, whatever they chose
 * for the old "appear publicly" switch (D6: only the organisers see the list). People whose
 * personal profile is gone are left out. Callers decide who may see it (canSeeEventGuests).
 */
export const listEventGuests = async (eventId: string): Promise<EventGuest[]> => {
    try {
        const rsvps = await EventRsvps.find({ eventId, status: { $in: ["going", "interested"] } })
            .project({ userDid: 1, status: 1, message: 1, createdAt: 1, updatedAt: 1, _id: 0 })
            .toArray();
        const dids = rsvps.map((r) => r.userDid).filter(Boolean);
        if (dids.length === 0) return [];

        const users = (await Circles.find({ did: { $in: dids }, circleType: "user" })
            .project({ ...IDENTITY_CIRCLE_PROJECTION, _id: { $toString: "$_id" } as any })
            .toArray()) as unknown as Circle[];
        const userByDid = new Map(users.map((u) => [u.did!, u]));

        const guests: EventGuest[] = [];
        for (const r of rsvps) {
            const user = userByDid.get(r.userDid);
            if (!user) continue;
            const since = r.updatedAt ?? r.createdAt;
            guests.push({
                user,
                status: r.status as EventGuest["status"],
                ...(r.message ? { message: r.message as string } : {}),
                ...(since ? { since: new Date(since) } : {}),
            });
        }
        return guests.sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));
    } catch (error) {
        console.error("Error listing event guests:", error);
        return [];
    }
};
