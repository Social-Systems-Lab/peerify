"use server";

// The owner's own spaces (see lib/data/space.ts). The owner is always the signed-in person: no
// action takes an owner from the client, and the data layer scopes every query to that DID, so
// another person's space id matches nothing. Errors are logged by name only: the input can hold
// a home's area and notes meant for Peerify.

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getRestrictedActionMessage } from "@/lib/auth/verification";
import {
    SPACES_PER_PERSON_MAX,
    SpaceView,
    createSpaceForOwner,
    deleteSpaceForOwner,
    getSpaceActor,
    listSpacesForOwner,
    updateSpaceForOwner,
} from "@/lib/data/space";
import { parseSpaceInput } from "@/lib/spaces/space-rules";

export type SpaceActionResult = { success: true; spaces: SpaceView[] } | { success: false; message: string };

const NOT_SIGNED_IN = "You need to be logged in to manage spaces.";
const NOT_FOUND = "That space wasn't found. It may have been deleted.";

const logFailure = (action: string, error: unknown) => {
    console.error(`${action} failed:`, error instanceof Error ? error.name : "unknown error");
};

const signedInDid = async (): Promise<string | undefined> => {
    try {
        return await getAuthenticatedUserDid();
    } catch {
        return undefined;
    }
};

export async function getMySpacesAction(): Promise<SpaceActionResult> {
    try {
        const did = await signedInDid();
        if (!did) return { success: false, message: NOT_SIGNED_IN };
        return { success: true, spaces: await listSpacesForOwner(did) };
    } catch (error) {
        logFailure("getMySpacesAction", error);
        return { success: false, message: "Could not load your spaces." };
    }
}

export async function createSpaceAction(raw: unknown): Promise<SpaceActionResult> {
    try {
        const actor = await getSpaceActor(await signedInDid());
        if (!actor) return { success: false, message: NOT_SIGNED_IN };
        if (!actor.canCreate) return { success: false, message: getRestrictedActionMessage("add a space") };

        const parsed = parseSpaceInput(raw);
        if (!parsed.ok) return { success: false, message: `Please check the form (${parsed.error}).` };

        const created = await createSpaceForOwner(actor.did, parsed.value, parsed.pickedLngLat);
        if (!created.ok) {
            return {
                success: false,
                message: `You can add up to ${SPACES_PER_PERSON_MAX} spaces. Delete one to add another.`,
            };
        }
        return { success: true, spaces: await listSpacesForOwner(actor.did) };
    } catch (error) {
        logFailure("createSpaceAction", error);
        return { success: false, message: "Could not save the space." };
    }
}

export async function updateSpaceAction(spaceId: string, raw: unknown): Promise<SpaceActionResult> {
    try {
        const did = await signedInDid();
        if (!did) return { success: false, message: NOT_SIGNED_IN };

        const parsed = parseSpaceInput(raw);
        if (!parsed.ok) return { success: false, message: `Please check the form (${parsed.error}).` };

        const updated = await updateSpaceForOwner(did, String(spaceId), parsed.value, parsed.pickedLngLat);
        if (!updated) return { success: false, message: NOT_FOUND };
        return { success: true, spaces: await listSpacesForOwner(did) };
    } catch (error) {
        logFailure("updateSpaceAction", error);
        return { success: false, message: "Could not save the space." };
    }
}

export async function deleteSpaceAction(spaceId: string): Promise<SpaceActionResult> {
    try {
        const did = await signedInDid();
        if (!did) return { success: false, message: NOT_SIGNED_IN };

        const deleted = await deleteSpaceForOwner(did, String(spaceId));
        if (!deleted) return { success: false, message: NOT_FOUND };
        return { success: true, spaces: await listSpacesForOwner(did) };
    } catch (error) {
        logFailure("deleteSpaceAction", error);
        return { success: false, message: "Could not delete the space." };
    }
}
