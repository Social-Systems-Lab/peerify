// Client-safe (2026-11-22). Calls a server action from a button and turns a throw (network error,
// server action error, server restart) into an ordinary failed result, so the button always gets a
// result to show and its "Sending…"/"Removing…" state always resets.

export const ACTION_FAILED_MESSAGE = "Something went wrong. Please try again.";

export const callAction = async <T extends { success: boolean; message?: string }>(
    action: () => Promise<T>,
): Promise<T | { success: false; message: string }> => {
    try {
        return await action();
    } catch (error) {
        console.error("Server action failed:", error);
        return { success: false, message: ACTION_FAILED_MESSAGE };
    }
};
