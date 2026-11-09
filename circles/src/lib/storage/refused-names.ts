// Names the public-bucket proxies (/storage and /uploads) refuse to serve, whatever the bucket
// holds. Offer photos (since 617d5f90) and verification attachments (since 6dc95547) live in the
// private bucket, and the old public copies were moved there and deleted (storage steps 4 and 5;
// on prod, checked done before this went out). An old public copy that was never moved (a photo
// removed from its offer before the move) or one written again must not be served to anyone who
// has its name.
//
// saveFile named them "<circle id>/<prefix>-<random or timestamp>.<ext>" (the oldest
// verification attachments "verification-attachment<timestamp>.<ext>", with no dash), so the
// check is on the start of the last path segment, ignoring case.

const REFUSED_PREFIXES = ["offer-photo", "verification-attachment"];

export const isRefusedPublicName = (objectName: string): boolean => {
    const last = objectName.split("/").pop()?.toLowerCase() ?? "";
    return REFUSED_PREFIXES.some((prefix) => last.startsWith(prefix));
};
