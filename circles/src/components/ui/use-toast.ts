"use client";

// Inspired by react-hot-toast library
import * as React from "react";

import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

// Error toasts (2026-11-22, platform-wide): an error (variant "destructive", or icon "error") gets
// the error style and stays until the person closes it (duration Infinity; Radix still closes it on
// ×, Escape or a swipe). Other toasts keep Radix's 5-second timeout. Up to TOAST_LIMIT show at
// once, so a new toast no longer replaces an error; when there are too many, the oldest non-error
// goes first. Closed toasts leave the list after their exit animation (TOAST_REMOVE_DELAY).
const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 1000;

type ToasterToast = Omit<ToastProps, "id" | "title" | "description" | "action"> & {
    id: string;
    title?: React.ReactNode;
    description?: React.ReactNode;
    icon?: "success" | "error" | "warning" | "info";
    action?: ToastActionElement;
};

const actionTypes = {
    ADD_TOAST: "ADD_TOAST",
    UPDATE_TOAST: "UPDATE_TOAST",
    DISMISS_TOAST: "DISMISS_TOAST",
    REMOVE_TOAST: "REMOVE_TOAST",
} as const;

let count = 0;

function genId() {
    count = (count + 1) % Number.MAX_SAFE_INTEGER;
    return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
    | {
          type: ActionType["ADD_TOAST"];
          toast: ToasterToast;
      }
    | {
          type: ActionType["UPDATE_TOAST"];
          toast: Partial<ToasterToast>;
      }
    | {
          type: ActionType["DISMISS_TOAST"];
          toastId?: ToasterToast["id"];
      }
    | {
          type: ActionType["REMOVE_TOAST"];
          toastId?: ToasterToast["id"];
      };

interface State {
    toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
    if (toastTimeouts.has(toastId)) {
        return;
    }

    const timeout = setTimeout(() => {
        toastTimeouts.delete(toastId);
        dispatch({
            type: "REMOVE_TOAST",
            toastId: toastId,
        });
    }, TOAST_REMOVE_DELAY);

    toastTimeouts.set(toastId, timeout);
};

export const isErrorToast = (toast: Pick<ToasterToast, "variant" | "icon">): boolean =>
    toast.variant === "destructive" || toast.icon === "error";

// Every toast() call goes through this: errors get the error style and no timeout unless the caller
// set a duration itself.
export const withErrorDefaults = <T extends Pick<ToasterToast, "variant" | "icon" | "duration">>(props: T): T =>
    isErrorToast(props)
        ? { ...props, variant: "destructive", duration: props.duration ?? Number.POSITIVE_INFINITY }
        : props;

const addToast = (toasts: ToasterToast[], toast: ToasterToast): ToasterToast[] => {
    const next = [toast, ...toasts.filter((t) => t.open !== false)];
    while (next.length > TOAST_LIMIT) {
        // index 0 is the new toast, which always shows; otherwise drop the oldest non-error
        const oldestNonError = next.map((t) => isErrorToast(t)).lastIndexOf(false);
        next.splice(oldestNonError > 0 ? oldestNonError : next.length - 1, 1);
    }
    return next;
};

export const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case "ADD_TOAST":
            return {
                ...state,
                toasts: addToast(state.toasts, action.toast),
            };

        case "UPDATE_TOAST":
            return {
                ...state,
                toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
            };

        case "DISMISS_TOAST": {
            const { toastId } = action;

            // ! Side effects ! - This could be extracted into a dismissToast() action,
            // but I'll keep it here for simplicity
            if (toastId) {
                addToRemoveQueue(toastId);
            } else {
                state.toasts.forEach((toast) => {
                    addToRemoveQueue(toast.id);
                });
            }

            return {
                ...state,
                toasts: state.toasts.map((t) =>
                    t.id === toastId || toastId === undefined
                        ? {
                              ...t,
                              open: false,
                          }
                        : t,
                ),
            };
        }
        case "REMOVE_TOAST":
            if (action.toastId === undefined) {
                return {
                    ...state,
                    toasts: [],
                };
            }
            return {
                ...state,
                toasts: state.toasts.filter((t) => t.id !== action.toastId),
            };
    }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
    memoryState = reducer(memoryState, action);
    listeners.forEach((listener) => {
        listener(memoryState);
    });
}

export type Toast = Omit<ToasterToast, "id">;

function toast({ ...props }: Toast) {
    const id = genId();

    const update = (props: ToasterToast) =>
        dispatch({
            type: "UPDATE_TOAST",
            toast: { ...props, id },
        });
    const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });

    dispatch({
        type: "ADD_TOAST",
        toast: {
            ...withErrorDefaults(props),
            id,
            open: true,
            onOpenChange: (open) => {
                if (!open) dismiss();
            },
        },
    });

    return {
        id: id,
        dismiss,
        update,
    };
}

function useToast() {
    const [state, setState] = React.useState<State>(memoryState);

    React.useEffect(() => {
        listeners.push(setState);
        return () => {
            const index = listeners.indexOf(setState);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        };
    }, [state]);

    return {
        ...state,
        toast,
        dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
    };
}

export { useToast, toast };
