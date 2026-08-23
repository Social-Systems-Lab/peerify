"use server";

import { getCircleById, getCirclePath, updateCircle } from "@/lib/data/circle";
import { FormSubmitResponse } from "@/models/models";
import { revalidatePath } from "next/cache";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features, modules } from "@/lib/data/constants";
import { getUserPrivate } from "@/lib/data/user";

// Each module toggle auto-saves on click (see ModuleEnabledToggle in pages-settings-form.tsx),
// so this only ever touches the single module it's called for. Still runs the same funding/
// readOnly/"general" normalization the old batch-save action did, since a module toggle can be
// triggered directly without going through a shared form submit.
export async function setModuleEnabledAction(
    circleId: string,
    moduleHandle: string,
    enabled: boolean,
): Promise<FormSubmitResponse> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to edit circle settings" };
    }

    const authorized = await isAuthorized(userDid, circleId, features.settings.edit_pages);
    if (!authorized) {
        return { success: false, message: "You are not authorized to edit circle settings" };
    }

    const moduleInfo = modules.find((module) => module.handle === moduleHandle);
    if (!moduleInfo) {
        return { success: false, message: "Unknown module" };
    }
    if (moduleInfo.readOnly) {
        return { success: false, message: "This module cannot be disabled" };
    }

    try {
        const existingCircle = await getCircleById(circleId);
        if (!existingCircle) {
            throw new Error("Circle not found");
        }

        if (moduleHandle === "funding") {
            if (enabled && existingCircle.circleType !== "circle") {
                return { success: false, message: "Funding Needs can only be enabled on circles in this MVP." };
            }
            const user = await getUserPrivate(userDid);
            if (!user.isAdmin) {
                return { success: false, message: "Only Super Admins can enable or disable Funding Needs." };
            }
        }

        let updatedModules = existingCircle.enabledModules ?? [];
        if (enabled && !updatedModules.includes(moduleHandle)) {
            updatedModules = [...updatedModules, moduleHandle];
        } else if (!enabled) {
            updatedModules = updatedModules.filter((handle) => handle !== moduleHandle);
        }

        // readOnly modules and "general" (not itself a toggleable module) must always stay enabled.
        const normalizedModules = modules
            .filter((module) => module.readOnly || updatedModules.includes(module.handle))
            .map((module) => module.handle);
        if (!normalizedModules.includes("general")) {
            normalizedModules.push("general");
        }

        await updateCircle({ _id: circleId, enabledModules: normalizedModules }, userDid);

        const circlePath = await getCirclePath(existingCircle);
        revalidatePath(`${circlePath}`);
        revalidatePath(`${circlePath}settings/pages`);

        return { success: true };
    } catch (error) {
        if (error instanceof Error) {
            return { success: false, message: error.message };
        }
        return { success: false, message: "Failed to update module setting. " + JSON.stringify(error) };
    }
}
