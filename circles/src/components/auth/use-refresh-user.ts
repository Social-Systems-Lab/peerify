"use client";

import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { checkAuth } from "@/components/auth/actions";

// userAtom (and its memberships) is hydrated once by Authenticator, and router.refresh() doesn't
// remount it. Call this after a server-side change to the user's memberships (e.g. accepting an
// admin invitation) so UI keyed on them updates without a full reload. A failed refresh is only
// logged: it delays that UI, it doesn't undo the change.
export const useRefreshUser = () => {
    const setUser = useSetAtom(userAtom);

    return useCallback(async () => {
        try {
            const auth = await checkAuth();
            if (auth.authenticated && auth.user) {
                setUser(auth.user);
            }
        } catch (error) {
            console.error("Error refreshing user:", error);
        }
    }, [setUser]);
};
