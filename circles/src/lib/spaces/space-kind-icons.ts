// The icon for each kind of space, shared by the Add a space chooser, the Explore Spaces
// sub-filter and the space panel, so a kind looks the same everywhere.

import { Building2, Home, Store, type LucideIcon } from "lucide-react";

export type SpaceKind = "venue" | "popup" | "private";

export const SPACE_KIND_ICONS: Record<SpaceKind, LucideIcon> = {
    venue: Building2,
    popup: Store,
    private: Home,
};
