// Icons for the "What you do" values (PEERIFY_ACT_OFFER_OPTIONS), shown in the Discover/Explore
// filter row. Lucide placeholders until the illustrated set exists (Tim, 2026-10-22).

import type { LucideIcon } from "lucide-react";
import {
    Baby,
    Disc3,
    FileMusic,
    Flower2,
    GraduationCap,
    Guitar,
    Laugh,
    MessageSquareQuote,
    Music,
    PartyPopper,
    Repeat2,
} from "lucide-react";
import type { PeerifyActOffer } from "./artist-profile";

export const PEERIFY_ACT_OFFER_ICONS: Record<PeerifyActOffer, LucideIcon> = {
    original_music: Music,
    covers_tributes: Repeat2,
    dj_sets: Disc3,
    session_musician: Guitar,
    lessons_workshops: GraduationCap,
    composing_film_games_theatre: FileMusic,
    childrens_music: Baby,
    sound_healing_meditation: Flower2,
    comedy: Laugh,
    spoken_word: MessageSquareQuote,
    weddings_private_events: PartyPopper,
};
