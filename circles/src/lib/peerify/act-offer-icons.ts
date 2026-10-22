// Icons for the "What you do" values (PEERIFY_ACT_OFFER_OPTIONS), shown in the Discover/Explore
// filter row. Lucide placeholders until the illustrated set exists (Tim, 2026-10-22).

import type { LucideIcon } from "lucide-react";
import {
    Baby,
    Clapperboard,
    Disc3,
    Flower2,
    GraduationCap,
    Guitar,
    Laugh,
    Music,
    PartyPopper,
    PenLine,
    Repeat2,
    SlidersVertical,
} from "lucide-react";
import type { PeerifyActOffer } from "./artist-profile";

export const PEERIFY_ACT_OFFER_ICONS: Record<PeerifyActOffer, LucideIcon> = {
    original_music: Music,
    covers_tributes: Repeat2,
    dj_sets: Disc3,
    songwriting: PenLine,
    session_musician: Guitar,
    lessons_workshops: GraduationCap,
    weddings_private_events: PartyPopper,
    childrens_music: Baby,
    sound_healing_meditation: Flower2,
    comedy_spoken_word: Laugh,
    composing_film_games_theatre: Clapperboard,
    production_engineering: SlidersVertical,
};
