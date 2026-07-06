# Peerify — Context Document

A working handoff document for the Peerify platform, written for use across AI sessions. Assumes the reader knows Kamooni and the Circles codebase.

**This document has two layers:**
- **§0 Build Status** and **§00 Roadmap** track *what is actually built and where it's going* — updated every session, freshest at the top.
- **§1–§11** are the product & design bible — the canonical vision, mechanics, pricing, and design system. Stable; changes rarely.

For the detailed engineering changelog, see `SESSION_LOG.md` (this doc is the overview; SESSION_LOG is the play-by-play).

---

## §0. Build Status — current reality

*Last updated: 2026-06-30.*

### Live on production right now (peerify.one)
- **Signup + auth** — personal-account-first signup, email confirmation, login/session. ALTCHA human-verification on signup (self-hosted, open-source).
- **Artist profiles** with a **Music module**: MP3 upload (mp3-only, 20MB cap), ffmpeg derivative generation, signed streaming, **play-only player**, 3-track-per-artist cap with ownership-checked delete. On-by-default for new artist profiles. **This is live and working end-to-end as of 2026-06-28.**
- **Founding-member infrastructure** (inherited from Kamooni; counter, badge, cap).
- Circles, events, messaging, reviews, noticeboards — inherited Circles primitives, present but not all Peerify-tailored yet.
- **Personal-profile settings cleaned up**: the "Peerify Artist Profile" section (checkbox + all artist metadata fields) removed from the personal-profile About settings page. Replaced with a calm amber info banner ("This is your personal profile… use the + Create button") with a persistent localStorage dismiss. Artist/band/venue creation continues via the Create button flow — settings page no longer suggests otherwise.
- **Peerify-branded default avatars live**: `default-user-picture.png`, `default-artist-avatar.png`, `default-band-avatar.png`, `default-venue-avatar.png` replaced with Peerify orange-on-dark 512×512 versions (~32–52 KB, pngquant-optimized, down from ~1.6 MB each).

### Infrastructure reality (important — supersedes older notes)
- **Server:** Hetzner, `tim@peerify` (65.21.91.96). Kamooni is a *separate* machine (`ubuntu@91.123.202.241`) — never cross commands.
- **Runtime:** bare-Node via PM2, NOT Docker (the repo Dockerfile exists but prod isn't deployed through it). Earlier context docs that imply Docker or `~/apps/peerify/circles` are STALE.
- **Prod:** PM2 `peerify` :3000, branch `main`, source `~/apps/peerify-app/circles` (repo root; the app lives one level down with worktree prefix `circles/`). **Confirmed 2026-07-01** via `pm2 jlist` + `ss -ltnp` + `/proc/<pid>/cwd` (independent cross-check, not just PM2's own bookkeeping): tracking `Social-Systems-Lab/peerify.git` (`origin`), branch `main`, HEAD `f7a4ebe6`, working tree clean.
- **Staging:** PM2 `peerify-staging` :3001, DB `peerify_staging`, bucket `circles-staging`, source `~/apps/peerify-staging/circles/circles`, env one level up.
- **`~/apps/peerify/circles` is a STALE leftover checkout** tracking the OLD `Social-Systems-Lab/circles.git` repo (pre-split). It is NOT serving anything — no PM2 process points at it. Do not confuse it with prod (`~/apps/peerify-app/circles`). Candidate for eventual removal.
- **Repo:** standalone `Social-Systems-Lab/peerify` (migrated off the shared Circles repo). HTTPS via nginx + Certbot. ffmpeg is a host dependency (`/usr/bin/ffmpeg` 6.1.1); prod `.env.local` sets `FFMPEG_PATH` explicitly.
- **⚠️ Prod PM2 process is long-running across the last rebuild:** `peerify` has been up since 2026-06-30 13:29 with no restart recorded since the 15:25 standalone rebuild that same day. Node caches required route modules in memory for the life of the process, so a route hit before 15:25 could still be serving a stale in-memory module even though the on-disk build is current. The on-disk build only becomes fully authoritative after a clean restart — treat "grep says X is in/out of the build" as necessary but not sufficient; a stale in-memory route is a live possibility until the next restart.
- **Golden rules:** confirm `hostname`/`pwd`/`git branch` before acting; staging before prod; one step at a time; review every diff; no autonomous git/infra changes; destructive commands as single standalone pastes.
- **Standalone deploys need asset copy, not just restart.** `bun run build` + `pm2 restart` alone will NOT update logo/hero/favicon — Next.js standalone output doesn't include `public/` or `.next/static`. Must copy both into the standalone folder after every build (see `deploy-peerify.sh` for prod's version). A successful restart is not proof the deploy is correct — verify the rendered page.

---
**⚠️ PM2 deploy-safety rule (this has caused prod downtime TWICE):**
- `--update-env` MERGES the current shell's env onto PM2's saved state — it does NOT replace it. A stray `PORT` exported earlier in the shell will silently propagate to the app you restart.
- Prod (`peerify`, id 8) runs on **PORT 3000** (no PORT in its .env.local; PM2 default). Staging (`peerify-staging`, id 5) runs on **3001** (set in staging .env.local).
- **ALWAYS** open a FRESH terminal tab for each app's deploy, OR run `unset PORT` before touching a different app.
- **ALWAYS** run `echo $PORT` immediately BEFORE any `pm2 restart`. Expect empty-or-3000 for prod, 3001 for staging. If it's wrong, STOP.
- After a correct prod restart, run `pm2 save` so a reboot resurrects the right port.
- Full incident write-ups: see SESSION_LOG.md (2026-06-30 cleanup sprint Learnings + the 502/EADDRINUSE incident).
---

### Design vs built — the gap ledger
| Surface | Design state | Build state |
|---|---|---|
| Landing page | mockup + integrated | **Built**; needs live artist/member/venue counts wired to DB |
| Artist profile | mockup v5 | **Built**; needs Peerify-tailoring (hide Kamooni-isms, side-panel UI changes — see Roadmap) |
| Fan profile | mockup v3 | partial (inherited Circles profile) |
| Music/upload/player | — | **Built + live** |
| Pledge | mockup (map popup, venue row, artist widget) | **Simple feature built**; needs refining |
| Map / Discover | mockup v2 | **Simple version built**; needs refining |
| Venue profile | mockup v1 (Bukowski) | not built |
| Host profile | not designed | not built |
| Payments (music sales) | — | **not built — targeted rudimentary by August** |
| Peerify Player | designed (§7 below as "the Player") | **deferred — needs resources we don't have yet** |

---

## §00. Roadmap

*The single place to track direction between sessions. Horizons, not hard dates, except where noted.*

### Milestone: artist onboarding (target 2026-07-15)
**Definition of done:** an artist can sign up → create a profile → upload tracks, and a fan can discover → play → pledge → book/contact the artist. **Clean, easy-to-understand UI with all Kamooni-specific or Kamooni-unique surfaces removed or hidden.** Minimum friction for both artists and fans creating profiles.

Concrete work toward it:
- **De-Kamooni the UI.** Hide (not necessarily delete — may be useful later) features that don't belong in Peerify or read as Kamooni-specific. Example: "verified contributions" on the profile page → hide. Audit profile + nav for other Kamooni-isms.
- **Artist side-panel UI changes** + how artists appear/present (details to define in-session).
- **Profile creation flow** — minimal-confusion path for artists *and* fans.
- **Landing page** — wire the artist / member / venue counters to real DB numbers.
- **Pledge** — refine the existing simple feature toward the designed mechanic (signal-not-escrow, contribution suggestion, contributor list; group-formation at 10% is later).
- **Map / Discover** — refine the existing simple version (real basemap, marker system per §4.6/§6, popup polish).
- **Book / Contact artist** — ensure the enquiry/contact path works end-to-end.

### Next: payments (rudimentary by 2026-08)
- Wire up a **payment portal to sell music** (digital file delivery + ownership tracking + the 90/10 commission model). Rudimentary is fine for August.
- **Tickets** sales follow music (later in the payments track).

### Campaign: crowdfunding launch (2026-09)
- Goal: raise **≥ €10,000** (hopefully well more) to take the prototype to **version one**.
- Purpose: spread the word, onboard more users/artists, attract sponsors/partners to cover dev + ops.
- Implication for the roadmap: the milestone + payments work above is effectively *campaign-readiness* — the platform needs to look credible and let a visitor actually sign up, hear music, and support an artist by September.

### Later (post-campaign / resource-dependent)
- **Peerify Player** (the native listening app + listening-data ingestion for dividends) — significant build, deferred until funded.
- **Venue + Host profiles**, venue-owner view, tour-team / group-formation flow, customisation UI, mobile-optimised patterns, alternate discovery views (Calendar/List), advanced search. (All designed or partially designed in §1–§11 below.)

### Carry-forward ops cleanup (next working session)

**✅ RESOLVED (2026-07-01, commit `6c30ad88`) — artist/band music-links Card restored**, gated on `isPeerifyManagedArtistCircle` only (personal profiles correctly keep the amber banner, no Card), Spotify removed. Verified rendering + data round-trip on staging (:3001). See `SESSION_LOG.md` 2026-07-01 entry.

**✅ RESOLVED (2026-07-01) — staging→main promotion complete.** Merged staging into main (merge commit `1f26690f`), prod rebuilt, PORT-safe restart, `pm2 save`. Verified live on peerify.one. Prod, staging, and main are now in sync. See 2026-07-01 `SESSION_LOG.md` entry.

Remaining carry-forward:

1. **Audit and remove inherited Kamooni/Cleura/Circles docs.** The repo carries
   stale docs from the Circles fork that describe a DIFFERENT platform on a
   DIFFERENT host (e.g. the Kamooni-flavoured `SESSION_LOG.md` lineage,
   `docs/cleura_deployment.md`, `docs/circles-deployment.md`,
   `docs/circles-registry-deployment.md`, and the root `deploy-genesis2.sh`
   Kamooni/Docker script). These are actively misleading. Process: inventory
   `docs/` with previews, triage each into {Kamooni-specific → remove,
   Circles-generic-still-useful → keep, Peerify-current → keep}, then `git rm`
   in one reviewable commit. Do NOT bulk-delete.
2. **Songwriter managed-identity type** — add constant `PEERIFY_DEFAULT_SONGWRITER_AVATAR_URL`, wire into `getPeerifyDefaultAvatarUrl()`, identity-type list, and Create flow. Optimized avatar prepared, not yet in repo.
3. **`default-profile-avatar.png`** (`public/peerify/`) un-optimized at ~1.6 MB — run pngquant.
4. **Banner flash-on-reload** — localStorage-gated banners (personal-profile + Verify Profile) flash one frame before `useEffect` hides them. Fix consistently: mounted-guard pattern or server-side preference.
5. **`canEditPeerifyArtistProfile` dead-const cleanup (now safe)** — the music-links Card it used to gate has been restored (commit `6c30ad88`, correctly gated on `isPeerifyManagedArtistCircle` alone). The old `canEditPeerifyArtistProfile` const in `about-settings-form.tsx` is now genuinely dead and can be removed in a separate cleanup session, along with general artist-settings polish. (Previously this item warned NOT to remove it, since it was evidence of the missing form — that regression is resolved; see 2026-07-01 `SESSION_LOG.md`.)
6. **Personal profile still renders circle chrome** ("Manage your circle's profile…", Pages / User Groups / Access Rules / Follow Requests) — de-Kamooni audit, separate task.
7. **`kam-yellow` / `kam-hero-yellow` color tokens** — Kamooni-named; rename to brand-neutral in palette overhaul.
8. **Over-broad `circles/` gitignore rule** (`circles/.gitignore` ~line 61) — matches `src/components/modules/circles/`; anchor or scope it.
9. **`*.bak` avatar backups** on staging + prod — delete now that prod is confirmed stable.
10. **Socials icon frame on public profile** — never built.
11. **`isVerified` overloaded for map/search discoverability** (discovered 2026-07-05). `isVerified` is meant to represent "account approved/activated by an admin" (set via `activateUserAccount()`, triggered by the admin "Verify Account" action or approving a verification request). However, this same flag is also the sole gate determining whether a personal/individual (`circleType: "user"`) profile appears in map results and search/discovery (see `isDiscoverableCircle`, `src/lib/data/search.ts:46-47`, and the identical `$or` clause in `getSwipeCircles`, `circle.ts:173`). This means any fan account an admin approves automatically becomes map-visible, regardless of `isPublic`, location precision, or explicit user choice. `isPublic` does not gate discovery at all currently — it only affects follow-approval requirements. Confirmed via prod DB query 2026-07-05: 5 of 9 `circleType: "user"` docs have `isVerified: true` (all pre-launch test/dev accounts, not real users), and all 5 have location coordinates set, so all 5 currently produce map pins. Not urgent pre-launch (no real users onboarded yet), but must be fixed before onboarding real fans, since it silently violates the stated MVP principle that only Artists/Venues/Events should be discoverable on the map for now. Proposed direction for a future session: decouple discovery visibility from `isVerified` into its own explicit field, and design a real visibility/discoverability setting individual users can control themselves (tie-in with the Access & Permissions card work from the 2026-07-05 Settings cleanup session).
12. **Bug: public Booking card shows base fee with no currency unit** (found 2026-07-05/06 Settings cleanup session). The artist's public Booking card renders the base fee as a bare number (e.g. "250") with no currency symbol or code alongside it, even though a currency value exists in the underlying data. Needs a small display fix on the public About/Booking rendering path to show fee + currency together (e.g. "250 EUR").
13. **Feature: booking base-fee currency is fixed, not user-selectable.** Artists currently cannot choose their own currency when setting a booking base fee — it's hardcoded/fixed rather than a field they control. Should become a proper currency picker tied to the base fee input, so artists can bill in their own local currency.
14. **Feature (bigger, roadmap): location-based/tiered booking fees.** An artist may want to charge a different base fee for the same type of gig depending on the market (e.g. more for a house show in Berlin than in Bangkok). This ties into the broader booking-logistics redesign already flagged above — the Minimum/Preferred audience size and Needs accommodation/transport/meal fields were removed from Booking settings (commit `cc8614ce`, 2026-07-06) specifically because they were too broad pending this kind of tiered-fee rethink. Proper design work (tiers by region/market, UI for managing them) is needed before building this.
15. **Rotate staging `MINIO_ROOT_PASSWORD`** — flagged as exposed in a prior session; rotation status unconfirmed as of 2026-07-06. Verify and rotate if not already done.

---

*(The product & design bible follows. §1–§11 below are the stable canonical vision and have not been rewritten — only the build-status and roadmap layers above are session-updated.)*

---
## 1. What Peerify is

**Peerify is a non-profit, community-powered music platform — a sibling to Kamooni on the same Circles foundation.** It replaces algorithmic streaming with a map of human beings making music. The thesis: an artist with 1,000 true fans should be able to make a living, and the bottleneck has always been infrastructure to enable direct relationships, fair economics, and viable micro-touring.

- **Owner:** Social Systems Foundation (non-profit, public benefit)
- **Sibling to:** Kamooni (same Circles codebase)
- **Pilot:** Cape Town
- **Current funding ask:** $20–30k (ultra-lean prototype, 4–5 months)
- **Domains:** **peerify.net** = HTML-based info/blog site (marketing, blogs, partner info). **peerify.one** = the app itself (the Circles-based platform). *(The older doc treated these as interchangeable; they are not.)*
- **Status:** Live MVP. Audio pipeline shipped to prod (see §0). Building toward the July-15 artist-onboarding milestone.

### The trio of core roles

A single account can hold multiple roles. Someone may be a fan, artist, host, or any combination. **Artist/band/venue profiles are created via the "Create" button** (NOT through the personal profile's Settings page — that route is confusing and is being removed; see §0/§00).

1. **Artists** — Make music, want to earn from it, willing to tour where supported.
2. **Fans/Supporters** — Buy music, pledge for tours, host shows, volunteer for tour teams.
3. **Venues/Hosts** — Physical spaces (commercial venues, homes) that host events. *These are two quite different sub-roles* — see 5.4.

---

## 2. The full set of problems Peerify solves

From the brand work, in narrative order:

1. **Discoverability without depth** — combines global artist discovery with local belonging.
2. **Loss of intimacy** — restores small rooms, real listening.
3. **Touring without safety nets** — pledge system enables risk-free micro-tours.
4. **Inadequate artist income** — multiple revenue streams, 90% to creator.
5. **Opaque algorithms** — open-source, user-driven discovery.
6. **Extractive business models** — non-profit, surplus returned to artists.
7. **Support that doesn't circulate** — fan membership credit goes back into the ecosystem.
8. **Fragmented music tools** — unifies discovery, sales, hosting, communication.
9. **Vanishing small venues** — every room becomes a viable micro-venue.
10. **Lack of trust for intimate events** — reviews, verification, private-event approval.
11. **Loss of music as social infrastructure** — restores shared civic experience.
12. **Artist sustainability collapse** — multiple revenue pillars.
13. **Algorithmic bias against non-viral genres** — community-curated, not click-ranked.
14. **Burnout and loneliness** — micro-communities, fan-clubs, circles.
15. **Travel/expansion difficulty** — pledge + community-hosting model.
16. **Fans want meaningful experiences but can't find them** — the map.
17. **Discovery lacks cultural context** — local scenes visible alongside artists.
18. **Artists don't own their audience** — direct, portable, lock-in-free.

### Tagline / brand voice
- "Peerify — The Next Stage of Music"
- "A peer-to-peer, non-profit ecosystem supporting small artists, local scenes, and a meaningful culture of listening."
- Manifesto: poetic and stirring, short-to-medium form. Vision: "restore music as a living, local, human experience." Mission: "empower artists to earn fairly, fans to connect deeply, communities to grow through intimate gatherings."

---

## 3. Mechanics — what we've decided

### 3.1 Commission

- **Music, tickets, fan-club fees: 10%** — Peerify invoices the artist after the fact. Payment is peer-to-peer.
- **Merchandise: 0%** — no commission on merch and vinyl.
- **VAT:** the artist's responsibility (not Peerify's).
- **Escrow:** Peerify does *not* hold pledged funds in escrow. Pledges are signals; when threshold is reached, pledgers confirm and pay the artist directly. Member-credit balances (the €4/month) *are* held by Peerify.

### 3.2 Pricing tiers

**Artists**
- Free tier (Community Artist): full profile, uploads, sales, gig listings, booking enquiries, basic supporter management. Genuinely usable.
- Pro tier (Artist): €2/month or €20/year. Unlocks video hosting, live broadcasts, segmented messaging, deeper analytics, expanded tour-planning tools.
- **First 1,000 artists free for 3 years** (Founding Artist program). Condition: minimum one social-media post per week marketing Peerify. After 3 years they pay the same as later artists.
- **Once an artist starts earning, their Pro subscription is deducted from the 10% commission as credit.** A successful artist effectively pays €0 for Pro.

**Fans/Members**
- Non-members: free, but see ads.
- Members: €5/month. **€4 of that is earmarked as the fan's music-purchase credit** (spendable within Peerify); €1 is the platform fee. Members get governance rights, no ads, enhanced trust, partner discounts.
- Founding members: paid only — no free founding members for fans. Membership #1–#1,000 get a recognised badge.

**Venues**
- No membership fee for MVP. Ticket commission only (10%).
- Per the Bar Bukowski mockup: venue absorbs the 10% rather than passing it to the artist. Worth keeping as a brand promise.
- A paid tier may come later when we know what features venues actually want.

**Advertising**
- Ads run for non-members only. Members get an entirely ad-free experience.
- The Artist Primer line "No advertising" should be updated to "no advertising for members."

### 3.3 Surplus distribution

- **Currently undecided, leaning toward 50/50.** Half of platform surplus returned directly to artists as dividends; half retained by the Foundation to fund Peerify, Kamooni, and other community projects.
- Dividend mechanic: based on Peerify Player listening data + plays at Peerify-organised live events. Plays from non-members or lapsed-member accounts don't count toward dividend calculations.
- Live-event plays may be weighted 20–50× standard plays.

### 3.4 The pledge mechanic

The core USP of Peerify. Two flavours:

- **Fan-initiated**: "Bring [Artist] to my city." Fans accumulate pledges; threshold = artist's travel costs + minimum fee.
- **Host-initiated**: "I'll host [Artist] in my living room." Host sets capacity, threshold = artist's set fee, pledges function as pre-sold tickets.

**Distance-aware contribution suggestion**: each pledger sees a suggested amount based on (transport cost) + (artist minimum fee) ÷ (target audience size). Can override.

**A pledge is a signal, not a payment.** Once threshold is reached, pledgers are invited to confirm and pay the artist directly. Peerify never holds the money.

**Group formation at 10% threshold.** When a pledge campaign hits 10% of goal, Peerify initiates a tour-team group and invites pledgers to take on a Tour Manager role to push the remaining 90%. This is a *social mechanic* — pledgers meet each other and bring the show into being together.

**Pledge-in-progress shows appear on venue calendars.** The Bukowski mockup puts a "PLEDGE IN PROGRESS · 57% FUNDED" entry directly in the upcoming-shows list, with an orange-tinted card, an inline pledge bar, and a "Pledge here" CTA. The held date is contingent on the campaign tipping. This is the venue's view of the same campaign that lives on the map and on the artist page.

### 3.5 Privacy model (fans)

**Private by default. Granular per-item visibility.** Each piece of profile info has its own audience:

- Anyone (open public)
- Logged-in Peerify members
- People at the same event as you
- Tour team members for a tour you're on
- Explicit contacts (people you've accepted)
- Just you

Three presets in the UI:
- **Strict** (everything contacts-only, default)
- **Open** (more visible to fellow members)
- **Public** (broadly visible)
- Custom (advanced)

**Public preview** = a deliberately limited view (symbolic avatar, no name/face, aggregate stats). Strangers see a calm business card; contacts see the real Marcus. No "ghost mode" feel — just calm by design.

**Contacts grow organically** through sharing songs via the Player, attending events, and explicit accept flows.

### 3.6 Tour offerings (the volunteer/host system)

Fans list what they can offer to touring artists — entirely opt-in, hidden from the rest of Peerify, visible only to matched tour teams:

- Spare bedroom
- Local transport
- Meals / cooking
- City knowledge
- Promotion help
- Venue introduction
- Photography/video
- Equipment loan

**Tour coordination** = lightweight task management inside Peerify (a tour event has a team + tasks + a comment thread). For complex tours, a tour manager can "promote" coordination into a Kamooni circle for full project management.

### 3.7 The Peerify Player

The listening heart of the ecosystem. Not a streaming app. **NOTE: deferred — a later project requiring resources not currently available (see §00 Roadmap).**

- Unique Player ID per installation
- Plays Peerify-format files only (purchased music)
- Each play counts toward dividend calculations
- **Ethical sharing**: two players in close proximity + artist consent + degree limits (e.g., 3 hops max from original purchase)
- **Gifting**: send playlists; sender purchases songs for recipient
- **Direct tipping**: 0% commission, listener-to-artist
- **Live-event plays weighted 20–50×** standard plays
- **Optional listener visibility**: opt-in to artists (top listeners, geographic spread)
- Song-level marginalia, time-stamped notes, non-competitive reactions
- "Listening With" mode: synchronized listening across distance
- Mobile apps (Android, iOS) planned

---

## 4. Visual design system

### 4.1 Brand identity

- **Logo:** orange location-pin shape with concentric broadcast rings and central figure. Recognisable, recolourable, used as the platform mark.
- **Wordmark:** "Peerify" in Cormorant Garamond 500.

### 4.2 Color system

```
--pf-ink:           #1A1612    warm near-black
--pf-cream:         #F2EBDB    page background (parchment)
--pf-paper:         #FAF6EC    card background
--pf-paper-light:   #FDFAF3    lightest paper (sub-sections)
--pf-line:          #DFD5BF    borders, dividers
--pf-line-soft:     #ECE3CC    softer dividers
--pf-muted:         #7D7164    secondary text
--pf-orange:        #E8732C    Peerify functional accent
--pf-orange-soft:   #F1A674    soft variant
--pf-orange-tint:   #F8E2CE    very light tint (badges, hovers)
--pf-sage:          #506B56    event-marker accent
```

*(Note: the live landing page currently uses main orange `#e8720c` / hover `#ff8c2a`. The palette above is the fuller design-system spec; old mustard values should be replaced where still visible. Reconcile during UI cleanup.)*

### 4.3 Typography

- **Display:** Cormorant Garamond (400, 500, italic 400/500/600). Used for headings, names, taglines, eyebrows.
- **Body:** Manrope (300–700). Used for paragraphs, UI labels, metadata.
- *Italic is a real semantic device* — used for taglines, eyebrows, footers, soft emphasis. Not decoration.

### 4.4 Three visual languages on one page

A consistent rule across the system:

- **Artist content** (their own page surfaces, their messaging, their music) uses **their chosen accent colour** (sage green for Lerato Khoza).
- **Venue content** uses **its chosen accent colour** with more restraint than artists get (Bar Bukowski: deep burgundy `#6B2E2E`). Same customisation system, smaller curated palette, more business-card energy than artist-as-performer energy.
- **Peerify mechanics** (pledge widgets, buy buttons, commission notes, founding badges, verification marks, "Book this room" widgets) always use **Peerify orange**.

Orange belongs to the platform doing its work; the role-holder's colour belongs to them.

**Fans don't customise.** Fan pages use the Peerify default palette (orange functional, ink accents). The platform protects; the artists and venues shine.

### 4.5 Page architecture

Standard layout pattern across role pages:

```
[Topbar — dark ink, full width, sticky]
[Hero or page-header — atmospheric (artist, venue) or calm (fan)]
[Profile-bar — pills, meta, actions; avatar straddles boundary]
[Section nav — tabs in italic display font, sticky under topbar]
[Main grid — content (1fr) + sidebar (380px)]
[Strip(s) — dark sections for platform-mechanics like upcoming/past shows]
[Reviews section — verified, role-appropriate]
[Footer — dark ink]
```

The map page departs from this — it's the centrepiece treatment (see 6.1). Profile-style pages share the skeleton above.

### 4.6 Marker system (for the map) — revised in Map v2

**All markers are Peerify pins.** The shape is the same across the board; differentiation is by **colour, size, label, and aura**. This was a deliberate change from the v1 plan (which used photo bubbles for artists, squares for hosts, rectangles for venues). The unified shape:

- avoids a surveillance-y "photos of strangers on a map" feel
- gives the platform a single recognisable map vocabulary
- lets the popup do the work of revealing identity

Variants:

- **Artist** — orange Peerify pin, with name label below
- **Pledge campaign** — orange Peerify pin with percentage label ("Lerato · 57%") and, if featured, a **soft pulsing aura**. Featured = viewer-personal (a pledge the viewer has personally pledged to).
- **Event** — sage-tinted Peerify pin, with date label ("14 Mar")
- **Venue** — deep-orange Peerify pin, with venue name label ("HKW Berlin")
- **Host** — cream/outlined Peerify pin, **no label** (hosts anonymous-until-matched)
- **Fan** — small dark Peerify pin, calm and private (used sparingly; see open question in §6)
- **Cluster** — pill with city name + count ("12 in London"), used at zoom-out

### 4.7 The Peerify pin as universal mark

The logo isn't just for the topbar. It appears at multiple scales as the *verification mark*:

- "[pin] 23 verified reviews" on album hero
- "[pin] Verified" badge in reviewer cards
- "[pin] PEERIFY PLEDGE" eyebrow on pledge widgets
- "[pin] verified buyer / verified attendee / verified host / verified artist" in user reviews
- "[pin] PEERIFY BOOKING" eyebrow on venue "Book this room" widget
- "[pin] FOR TOURING ARTISTS" eyebrow on venue terms grid

The pin says *this happened on Peerify, we can vouch for it*.

---

## 5. Mockups built (design phase — see §0 for what's actually coded)

All HTML files self-contained. **Newer mockups embed images as base64 data URIs** (atmospheric warm gradient placeholders with italic initials for portraits) — see 7.7 for the technique. This makes the files fully portable; recipients on any network see the design as intended.

### 5.1 Artist profile — v5 (Lerato Khoza)
**File:** `peerify-artist-profile-v5.html`

Lerato Khoza, folk-soul singer-songwriter from Cape Town. Founding artist #47. Subject's chosen palette: deep moss green accent, Cormorant Garamond italic display, warm parchment background. Cover photo + 240px circular portrait overlapping into parchment. Page anatomy:

- Hero (atmospheric, dark with cover image, name + tagline only)
- Profile-bar (pills, meta with **187 supporters**, action buttons: Pledge/Book/Follow/Tip)
- Tabs: About · Music · Shows · Fan Club · Merch · Updates · Reviews
- Main: Latest release (with verified-review rating), songs list, "What listeners say" verified review cards, bio
- Sidebar: Pledge widget (Berlin/London cities), Book widget, Quick facts, Elsewhere links
- Upcoming Shows strip (dark, three event-card types: public/house/pledge-in-progress)

Key decisions baked in:
- **Followers → "supporters"** (only people who've actually spent money count)
- **Verified reviews** with the Peerify pin as authenticity mark
- **Per-track ratings** inline
- **90% to artist** transparency note next to buy buttons
- Hero text in upper-middle, avatar at lower-left straddling boundary (no overlap with name/subtitle)

### 5.2 Fan profile — v3 (Marcus Voss)
**File:** `peerify-fan-profile-v3.html`

Marcus Voss, Berlin-based patron and tour-team volunteer. Founding member #312. Owner's view (Marcus logged in, viewing his own profile). Visual treatment quieter than artist's — Peerify default theme, no per-user customisation, calm paper-coloured header, no big atmospheric cover image. Fans aren't on display.

Section nav: Overview · Messages · Feed · Supporting · Circles · Reviews · Library · Tour team · Events · Contributions · Settings. Sidebar includes Founding member #312, recent contributions timeline, privacy-by-default matrix, and "what strangers see" symbolic avatar.

### 5.3 Discover/Map — v1 (superseded by v2)
**File:** `peerify-discover-map-v1.html` — first pass, two-pane split. Superseded.

### 5.4 Discover/Map — v2
**File:** `peerify-discover-map-v2.html` (images embedded). Centrepiece treatment per §6. The map IS the page. Floating filter bar, view toggle (Map/Calendar/List), right-slide results panel, markers across Europe centred on Berlin, horizontal quick-preview popup. Basemap is still a stylised SVG placeholder; real Mapbox swap-in is its own task.

### 5.5 Venue profile — v1 (Bar Bukowski)
**File:** `peerify-venue-profile-v1.html` (images embedded). Bar Bukowski, an 80-seat jazz listening room in Kreuzberg, Berlin. Founding venue #12. Deep burgundy `#6B2E2E`. Calendar tab built out (incl. a pledge-in-progress row), "what artists can expect" terms grid, dual-source reviews (artists vs listeners), past-shows strip. Other tabs (About, Past shows, The space, For artists, Contact) still need content layouts.

---

## 6. Map v2 — what was decided and built (design)

### 6.1 Map is the *centrepiece*
The map IS the page, not a panel within a layout. Other panels (filters, results, popups) **float over the map**. Airbnb-style but more committed: map fills the viewport, UI elements layer on top with backdrop blur.

### 6.2 Discovery hierarchy
**Artists across the globe is the primary discovery mode.** Not pledges, not events. We want people **discovering artists they didn't know existed** and then choosing to support them directly (buy / follow / pledge).

### 6.3 Pill order — settled
**All · Artists · Events · Offerings · Venues · Pledges** (All default; Artists first; Pledges last/deprioritised; Offerings = the volunteer-marketplace side).

### 6.4 Quick-preview popup — horizontal layout
Marker click opens a small popup over the map (400px × ~210px). Dark eyebrow bar (pin + campaign label + % funded), image left with centred play button, body right (name, location, pledge widget, two CTAs). **Click → hear → decide.** Full artist page is a deliberate next step.

### 6.5 Follow/Notify-me (softer than pledge)
**Notify me when [Artist] plays within [Y] km** — a watchlist commitment level between passive browsing and active pledge. Feeds demand signal without requiring money or organising.

### 6.6 Group formation at 10% pledge threshold
At 10% of goal, Peerify auto-initiates a group (circle-shaped object) and invites pledgers; someone can volunteer as Tour Manager; the group works toward the remaining 90%; once funded, the group becomes the tour team. A **social mechanic** as much as logistical.

### 6.7 Still to do on the map
Real Mapbox basemap; marker clustering at zoom-out; featured-pledge pulse logic (viewer-personal); host privacy at zoom (city-zoom-or-wider only, or location-jitter); advanced genre-aware search; **open question: should fans appear as map pins at all?** (deferred).

---

## 7. Decided patterns worth keeping in working memory

### 7.1 Founding artist mechanics
Reuses Kamooni's founding-member system (counter, window-open toggle, cap, revocation path). New wrinkle: the **weekly social post requirement** for the 3-year free window — new engineering (compliance check, grace period, admin surfacing). Not in the Kamooni system.

### 7.2 Naming
- **"Map" stays** as the nav label (not "Discover"). Distinctive — most platforms have Discover; few have a map.
- "Followers" → **"Supporters"** (people who've spent money).

### 7.3 Verified reviews — two dimensions on venue pages
Artist-page reviews come from listeners (verified buyer/attendee). Venue-page reviews come from **two audiences** with a toggle: **From artists** (who played there — pay, room, audience attention, treatment) and **From listeners** (atmosphere, programming, value). Same Peerify-pin verification mark. No anonymous reviews. N=5 minimum to display aggregate ratings.

### 7.4 Customisation
- **Artists choose** accent colour, display font (curated set of ~6–8 pairings), cover photo, tagline.
- **Venues choose** the same from a more restrained curated palette.
- **Fans don't customise.** Default symbolic avatar (initials in a Peerify-warm circle).

### 7.5 Per-role page-component patterns (cross-reference for porting)

| Pattern | Used on | Notes |
|---|---|---|
| Atmospheric hero + cover photo | artist, venue | Fans get a calm paper header |
| Avatar straddling hero boundary | artist, venue | Fans don't (contained) |
| Profile-bar with pills + meta + actions | all three | Same skeleton, role-specific pills |
| Tabbed section nav (italic display) | all three | Tab list varies per role |
| Main + 380px sidebar grid | artist, venue | Fan uses single-column |
| Pledge widget (orange) | artist sidebar, map popup, venue calendar row | Always orange; always Peerify mechanic |
| "What artists can expect" terms grid | venue | Orange six-cell grid; venue's transparency promise |
| Dark mechanism strip | artist (upcoming shows), venue (past nights) | Same chrome, opposite time direction |
| House-rule callout (dark, single italic) | venue | Personality declaration |
| Reviews section with toggle | venue (artists vs listeners) | Dual-source on venue |
| Press-quote block (burgundy left rule) | venue | Reusable on artist pages |

### 7.6 Pledge-in-progress show treatment
When a campaign is mid-funding and a date is held at a venue, the calendar shows a **distinct card variant**: orange-tinted bg, orange date number, "PLEDGE IN PROGRESS · X% FUNDED" eyebrow, inline pledge bar + meta, "Pledge here" + "Notify me" CTAs, "held date pending pledge confirmation" note. Same campaign appears on three surfaces (map pin, artist sidebar, venue calendar) — one canonical pledge object.

### 7.7 Embedded-image technique (for mockup portability)
Standalone HTML mockups embed images rather than reference external URLs. The generator (`gen_placeholders.py`) produces atmospheric warm-gradient placeholders with film grain + italic initials, deterministic per seed (~30KB/image, JPEG q78). Placeholders signal "mockup" honestly while staying on-brand; swap real photos in one-for-one when they arrive.

---

## 8. Design backlog (consolidated into §00 Roadmap)

*The original "still to design" list now lives in the §00 Roadmap with proper horizons. Kept here for the detailed design notes:*

- **Pledge campaign page** — the transaction surface the map sends people to (threshold mechanic, contribution suggestion, contributor list, 10% group-formation invitation).
- **Group formation / Tour Manager onboarding** — the 10%-threshold conversion flow.
- **Host profile** — distinct from venue; private individual offering their home; closer to the fan pattern (private-by-default, symbolic avatar, no public discoverability until matched).
- **Venue owner view** — Marc & Lisa managing Bukowski (calendar editor, booking-enquiry inbox, revenue dashboard).
- **Mobile patterns** — especially the map (touch markers, popup positioning, bottom sheet vs floating).
- **Customisation UI** — font/colour/cover picker (+ venue restraint controls).
- **Player UI** — the listening experience (separate app, deferred).
- **Onboarding flows, discovery views (Calendar/List), search results, other venue tabs.**

---

## 9. Open questions to revisit

- **Surplus split percentage** (50/50 between artists and Foundation? Or different?)
- **Whether to require human verification (KYC-lite)** for any roles (ALTCHA now gives a basic human tier; deeper verification TBD).
- **What "Founding Member" means for fans** beyond a numbered badge (any perks?)
- **Tour coordination split**: simple Peerify-native tasks vs. full Kamooni promotion — at what complexity does it cross over?
- **Whether fan-club posts appear in the public Overview feed.**
- **Whether public artist ratings show on profiles or only on individual works.**
- **Whether fans should appear as map pins at all** (deferred from Map v2).
- **Whether the "what artists can expect" grid is the right venue commitment**, or a separate "For artists" page.

---

## 10. What's shared with Kamooni (Circles primitives reused)

Inherited from Circles, usually with minor tweaks: Accounts/auth, Circles (fan clubs, thematic/private circles), Events (extended with Peerify event types), Members (extended with role types), Founding-member system (+ social-post compliance check), Noticeboards/posts (the Feed), Goals/Tasks (lightweight tour coordination), Messages, Reviews (extended with verification marks + venue dual-source), Settings/visibility (extended for granular privacy).

**Net-new in Peerify (not in Kamooni):** the Pledge object; the Offerings object; the Peerify Player; the map-based discovery layer; music-sales infrastructure (file delivery, format conversion, ownership tracking); ticket-sales infrastructure; the 90/10 commission ledger; verification marks; music-credit balance system (€4/month earmarking); venue calendar with pledge-in-progress variant; the "what artists can expect" venue terms object.

**De-Kamooni note:** the UI still surfaces Kamooni-specific or Kamooni-unique features that should be hidden (not necessarily deleted) for Peerify — e.g. "verified contributions" on profiles. This is an open-ended audit tracked in §00.

---

## 11. Concrete build notes (salvaged from prior repo checkpoints)

### Landing page implementation
- `src/app/page.tsx`, `src/app/welcome/page.tsx`
- `src/components/pages/peerify-landing-page.tsx` + `.css`
- Uses a temporary fixed-overlay CSS approach to bypass the inherited Circles app shell on public routes. Works visually; a future cleanup should split public pages from app-shell pages properly.
- **TODO:** wire the artist / member / venue counters to real DB numbers.

### Assets
- Peerify assets in `public/peerify/`. Logo `/peerify/logo-mark.png`, favicon `/peerify/favicon.ico`.
- Landing images: everyone.jpg, fans.jpg, artist.jpg, hosts.jpg, about.jpg, contact.jpg, involved.jpg.

### Auth/session
- Now served over HTTPS → `CIRCLES_COOKIE_SECURE=true` (the earlier HTTP-pilot `false` is resolved).

### Onboarding routes (early)
- `/signup/pilot`, `/signup/pilot/check-email`, `/onboarding/peerify?intent=fan|artist|host` exist as the first role-choice screens. (Note: the profile-creation flow is being reworked to go via "Create" — see §00.)

### Snapshots
- `~/peerify-snapshots/peerify-onboarding-auth-working-20260608-0916.tar.gz` (+ a later landing snapshot).

## Repository & Branch Reference (corrected 2026-07-05)

**Current, correct setup:**
- Peerify's live code lives at `Social-Systems-Lab/peerify` on GitHub (moved 
  out of the shared `circles` repo on 2026-06-24).
- Prod branch is `main` on the `peerify` repo — NOT `product/peerify`.
- Prod worktree path: `/home/tim/apps/peerify-app/circles` (un-nested — 
  no double `circles/circles`).
- Staging worktree path: `/home/tim/apps/peerify-staging/circles/circles` 
  (double-nested — different structure from prod, easy to confuse).

**Deprecated / do not use:**
- `/home/tim/apps/peerify/circles/circles` — this is a leftover worktree 
  from the OLD shared `circles` repo (`Social-Systems-Lab/circles`), 
  checked out on branch `product/peerify`. It was frozen at the exact 
  commit of the June 24 repo move and tagged `archive/product-peerify-final`. 
  It is NOT the current production code and should not be used for any 
  future merges or deploys.
- The `circles-origin` remote (pointing to the old `circles` repo) is 
  present in the current prod worktree but explicitly disabled for push, 
  by design.

**Merge workflow for staging → prod:**
1. From the staging worktree, push staging to origin: `git push origin staging`
2. Switch to the prod worktree (`/home/tim/apps/peerify-app/circles`), 
   confirm `git branch --show-current` shows `main`
3. `git fetch --all`, then `git merge origin/staging`
4. Review `git log --oneline main..origin/staging` before AND after the 
   merge to confirm expected commits landed
5. `git push origin main`
6. Run `./scripts/deploy-peerify.sh` from the prod worktree
