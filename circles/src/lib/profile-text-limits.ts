// Length rules for a profile's name, description (the text under the name) and mission. Shared by
// the inline header editor, its server action (updateCircleField) and Settings → About (saveAbout),
// so the browser and the server refuse the same things with the same message. Values are trimmed
// before they are checked; too-long text is refused, never cut.

export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_DESCRIPTION_MAX_LENGTH = 200;
export const PROFILE_MISSION_MAX_LENGTH = 500;

export const PROFILE_TEXT_FIELDS = ["name", "description", "mission"] as const;
export type ProfileTextField = (typeof PROFILE_TEXT_FIELDS)[number];

const LIMITS: Record<ProfileTextField, number> = {
    name: PROFILE_NAME_MAX_LENGTH,
    description: PROFILE_DESCRIPTION_MAX_LENGTH,
    mission: PROFILE_MISSION_MAX_LENGTH,
};

const LABELS: Record<ProfileTextField, string> = {
    name: "Name",
    description: "Description",
    mission: "Mission",
};

export const isProfileTextField = (field: string): field is ProfileTextField =>
    (PROFILE_TEXT_FIELDS as readonly string[]).includes(field);

export const getProfileTextMaxLength = (field: ProfileTextField): number => LIMITS[field];

/** Why `value` (already trimmed) can't be saved as `field`, or null when it can. */
export const validateProfileText = (field: ProfileTextField, value: string): string | null => {
    if (field === "name" && value.length === 0) {
        return "Name can't be empty.";
    }

    const max = LIMITS[field];
    if (value.length > max) {
        return `${LABELS[field]} can be at most ${max} characters. This text has ${value.length}; please shorten it. Nothing was saved or cut.`;
    }

    return null;
};
