// Shared, client-safe copy for connection notifications. The server stores this text as the
// notification body (and uses it for push); the bell rebuilds it from the type and actor name, so
// rows stored before the wording changed read the same as new ones.
export const getConnectionNotificationBody = (
    type: "contact_request_received" | "contact_request_accepted",
    actorName?: string,
): string => {
    const name = actorName || "Someone";
    return type === "contact_request_received"
        ? `${name} sent you a connection request`
        : `${name} accepted your connection request`;
};
