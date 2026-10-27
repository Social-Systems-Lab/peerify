// The rights statement an artist ticks when uploading a track (TrackUploadForm), and which
// uploadTrackAction stores with the track: the version key and the full text.
//
// Append-only. Never edit or remove an entry: stored tracks point at these keys. To change the
// wording, add a new entry (key = the date the wording changed) and move
// CURRENT_TRACK_RIGHTS_VERSION to it. Tracks without rightsAttestationVersion were uploaded under
// "2026-06-26", the original wording (added in fcb90840 on 2026-06-26), which was never stored.
export const TRACK_RIGHTS_ATTESTATIONS = {
    "2026-06-26": "I own or control the rights to this audio and have permission to upload it.",
    "2026-10-27": "I own or control the rights to this audio and/or have permission to upload it.",
} as const;

export type TrackRightsVersion = keyof typeof TRACK_RIGHTS_ATTESTATIONS;

export const CURRENT_TRACK_RIGHTS_VERSION: TrackRightsVersion = "2026-10-27";

export const CURRENT_TRACK_RIGHTS_TEXT = TRACK_RIGHTS_ATTESTATIONS[CURRENT_TRACK_RIGHTS_VERSION];

// Shown when the form someone submits shows an older (or no) wording, e.g. a page left open
// across a deploy: the stored version must be the wording they actually saw.
export const TRACK_RIGHTS_STALE_MESSAGE = "The upload form has changed. Please reload the page and try again.";
