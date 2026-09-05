"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleById, getCirclePath, updateCircle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { Circle, FormSubmitResponse } from "@/models/models";
import { revalidatePath } from "next/cache";

export async function savePresence(data: Circle): Promise<FormSubmitResponse> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            throw new Error("User not authenticated");
        }

        const engagementInterests = data.engagements?.interests;
        const engagementSettings: Circle["engagements"] = data.engagements
            ? { ...data.engagements }
            : undefined;

        if (engagementSettings) {
            delete engagementSettings.interests;
        }

        // offersVisible is deliberately NOT included here — it auto-saves on click via its own
        // dedicated action (setOffersVisibleAction below), the same reasoning as crewEnabled
        // being kept out of saveAbout()'s whitelist: submitting this form must never silently
        // reset it back to a stale form-default value.
        await updateCircle(
            {
                _id: data._id,
                interests: engagementInterests,
                offers: data.offers,
                engagements: engagementSettings,
                needs: data.needs,
                tourTeamOfferings: data.tourTeamOfferings,
            },
            userDid,
        );

        revalidatePath(`/circles/${data.handle}/settings/presence`);
        revalidatePath(`/circles/${data.handle}/home`);
        revalidatePath(`/circles/${data.handle}`);

        return {
            success: true,
            message: "Presence settings updated successfully",
        };
    } catch (error) {
        console.error("Error saving presence settings:", error);
        return {
            success: false,
            message: "Failed to update presence settings",
        };
    }
}

// Deliberately its own action rather than a field on savePresence() — the offers-map-visibility
// toggle auto-saves on click (see the OffersVisibleToggle component in presence-settings-form.tsx),
// so it must not be bundled into the same form state as the offerings editor/needs/engagements,
// which only save when the shared Save Changes button is clicked. Mirrors setCrewEnabledAction
// (settings/about/actions.ts) exactly.
export async function setOffersVisibleAction(circleId: string, offersVisible: boolean): Promise<FormSubmitResponse> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to edit circle settings" };
    }

    const authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
    if (!authorized) {
        return { success: false, message: "You are not authorized to edit circle settings" };
    }

    try {
        await updateCircle({ _id: circleId, offersVisible }, userDid);
    } catch (error) {
        return { success: false, message: "Failed to update offers visibility. " + error?.toString() };
    }

    const circle = await getCircleById(circleId);
    const circlePath = circle ? await getCirclePath(circle) : null;
    if (circlePath) {
        revalidatePath(circlePath);
        revalidatePath(`${circlePath}settings/presence`);
    }

    return { success: true };
}
