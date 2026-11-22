# Peerify backlog

_Last updated: 22 November 2026_

Each item can become one GitHub issue: the heading is the issue title, and the rest is the issue body. Sizes are rough guesses (S = under a day, M = 1–3 days, L = more than 3 days). Priorities are suggestions: **P1** means before or around the 6 Dec home show, **P2** means soon after, **P3** means later.

> **Security:** never file security weaknesses here. Report them privately to Tim (or as a private GitHub security advisory). Security work is tracked separately and always takes precedence over this backlog.

---

## Crew and tasks

### 1. Pending crew applications on the Crew Dashboard
- **Area:** Crew · **Type:** UX · **Priority:** P1 · **Size:** S
- **Problem:** Crew applications are only visible under Settings, and the application notification has no Review button.
- **Proposal:** List pending applications on the Crew Dashboard, add a count badge on the Crew Dashboard button, and add a Review button to the notification.
- **Done when:** An artist can find and act on a new application from the notification, the dashboard and the badge.

### 2. A clear way to leave a Crew
- **Area:** Crew · **Type:** UX · **Priority:** P1 · **Size:** S
- **Problem:** A Leave Crew action exists, but members can't easily find it.
- **Done when:** A crew member can leave from an obvious place on the Crew page, keeping their follower status.

### 3. Action buttons in task notifications
- **Area:** Notifications, Tasks · **Type:** UX · **Priority:** P1–P2 · **Size:** S
- **Problem:** Notices that need a decision only have a "View" button and look the same as information-only notices. After a claim is approved or a task assigned, people must still press "Confirm I'll do this", and they forget.
- **Proposal:**
  - Admins can approve a claim straight from the notice.
  - The assignee's notice reminds them to confirm, with an Accept button in the notice.
  - Notices that need action show a visible "action needed" state until handled.
- **Done when:** Both approvals and confirmations can be done from the notice, and action-needed notices stand out.

### 4. The "!" badge on notification avatars
- **Area:** Notifications · **Type:** UI · **Priority:** P3 · **Size:** S
- **Problem:** Some notifications show a "!" badge on the avatar, and its meaning isn't clear.
- **Proposal:** Give it one meaning (for example, action needed, tying in with item 3), or remove it.
- **Done when:** The badge has one clear meaning and appears only in that case.

### 5. Task and shift form tweaks
- **Area:** Crew, Tasks · **Type:** UX · **Priority:** P2 · **Size:** S
- **Proposal:**
  - Move the Event field to the top, just below "Create in", and preselect it when the task is created from an event.
  - Show a "Crew only" pill on crew-only tasks.
  - Shifts created by an admin start approved.
- **Done when:** All three behave as described.

### 6. Tapping a crew member opens their slider panel
- **Area:** Crew · **Type:** UX · **Priority:** P2 · **Size:** S
- **Done when:** Tapping a member in the crew list opens the same profile slider panel used elsewhere.

### 7. "My Crews" on the personal profile
- **Area:** Crew, Profiles · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Proposal:** A section on the personal profile giving quick access to the person's crews and their latest updates, like a unified crew feed.
- **Done when:** A member of several crews can see all of them and their recent posts in one place.

---

## Events

### 8. Guest list is cramped on laptops
- **Area:** Events · **Type:** UI · **Priority:** P2 · **Size:** S
- **Problem:** On desktop the organiser guest list sits in the narrow right-hand column, so names and handles are cut short ("T…", "@t…"). On a phone the same layout works well.
- **Proposal:** Either hide the @handle when space is tight, or give the guest list the full page width below the event details on wide screens.
- **Done when:** Full display names are readable on a 13" laptop, and the mobile layout is unchanged.

### 9. Party size per RSVP (plus-ones)
- **Area:** Events · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Problem:** Capacity counts RSVPs, not people. A guest who brings a friend takes two places but counts as one. Organisers work around this with "Places taken outside Peerify".
- **Proposal:**
  - A host setting per event: plus-ones allowed (yes/no, and a maximum per guest).
  - When attending, the guest chooses a party size.
  - Confirmed places, places left and Sold out all count people, not RSVPs. Each person still needs a ticket.
- **Done when:** A confirmed guest with party size 2 takes 2 places, and the confirm cap and places left both reflect it.

### 10. Tell the waiting list when a place opens
- **Area:** Events · **Type:** Feature · **Priority:** P2 · **Size:** S–M
- **Problem:** When an organiser presses Undo or raises the capacity on a sold-out event, people on the waiting list aren't told.
- **Proposal:** When places left goes from 0 to above 0, notify the people who attended while the event was full, in the order they joined. Decide first whether to notify all of them, or one at a time.
- **Done when:** Waiting guests get a notification linking to the event when a place frees up.

### 11. One form section for tickets and places
- **Area:** Events · **Type:** UI · **Priority:** P2 · **Size:** S
- **Problem:** Ticketed, price, capacity, places taken outside Peerify and the note for confirmed guests are spread across the event form. The price field is also cramped.
- **Proposal:** Group them in one roomier section called "Tickets & places", in a logical order.
- **Done when:** All the fields sit together, and validation still works.

### 12. Payment link or copyable payment details
- **Area:** Events · **Type:** Feature · **Priority:** P2 · **Size:** S–M
- **Problem:** Until there's a payment system, hosts put payment details in free text, and guests have to copy them by hand.
- **Proposal:** An optional payment link (for example SnapScan, PayPal or a bank link) and/or a block of payment details with a Copy button, shown to confirmed guests only, like the guest note.
- **Done when:** A confirmed guest can open the link or copy the details in one tap, and nobody else sees them.

### 13. Ticketed values lost when toggling
- **Area:** Events · **Type:** Bug · **Priority:** P2 · **Size:** S
- **Problem:** Price, currency and payment values are lost if "Ticketed" is switched off and on again before saving.
- **Done when:** Values survive the toggle until the form is saved or discarded.

### 14. New events prefill the venue's location
- **Area:** Events, Venues · **Type:** UX · **Priority:** P2 · **Size:** S
- **Done when:** An event created from a venue starts with that venue's location (respecting its pin or area setting, item 30).

### 15. Simplify event location settings
- **Area:** Events · **Type:** UX · **Priority:** P2 · **Size:** M
- **Problem:** The location settings are confusing, even for the team. The private/home event toggle also reverts to on after saving. Private event creation is currently hidden, which hides the bug for now.
- **Proposal:** A design pass first, then a rebuild of the location section together with item 30.
- **Done when:** A host can set a public, private or area location without guessing, and the setting sticks.

### 16. Hide RSVP buttons on draft events
- **Area:** Events · **Type:** Bug/UX · **Priority:** P2 · **Size:** S
- **Problem:** Draft events show RSVP buttons, including in "Preview as a fan", although nobody can attend a draft.
- **Proposal:** Hide them on drafts, or replace them with a note such as "RSVP opens when the event is published".
- **Done when:** Drafts show no working RSVP buttons, and a published event is unchanged.

### 17. Clearer places wording for guests
- **Area:** Events · **Type:** UI copy · **Priority:** P3 · **Size:** S
- **Problem:** Guests see "Attendees (going): 3 · 2 tickets left". Places are counted from confirmed guests, so this reads as a contradiction.
- **Proposal:** Show only what guests need, for example "2 places left" or "Sold out".
- **Done when:** The wording is agreed and applied in the RSVP box and the map popup.

### 18. Places left or Sold out on event cards
- **Area:** Events, Map, Discover · **Type:** UI · **Priority:** P3 · **Size:** S
- **Problem:** Places left and Sold out only show on the event page.
- **Proposal:** A small label on event cards and pins ("5 left" or "Sold out"), and a Sold out badge on the event hero. Use the combined places count only, never the separate confirmed or outside numbers.
- **Done when:** Cards show the same places-left figure as the event page.

### 19. Clickable links in invite and description text
- **Area:** Events · **Type:** Feature · **Priority:** P3 · **Size:** S
- **Proposal:** Turn web addresses into links, opening in a new tab with `rel="noopener noreferrer"`.
- **Done when:** Addresses in event text can be clicked, and other formatting is unchanged.

### 20. Genre selection for events
- **Area:** Events, Discovery · **Type:** Feature · **Priority:** P3 · **Size:** M
- **Problem:** The map's genre filter only applies to artists and venues, so unrelated events stay visible.
- **Proposal:** Hosts choose one or more genres for an event, from the same list as artist profiles. The map and Discover filter events by genre.
- **Done when:** Events can be tagged and filtered by genre.

### 21. Event reviews
- **Area:** Events, Trust · **Type:** Feature · **Priority:** P3 · **Size:** L
- **Background:** The plan is that "everyone reviews everyone" after a home show: guests, hosts and artists.
- **Proposal:** After the event, attendees, the host and the artist can review each other. Reviews feed the reputation and trust layer. Rules are needed on who may review whom, editing and removing reviews, and moderation.
- **Done when:** To be defined with the trust and reputation design.

### 22. Events backlog (to scope)
- **Area:** Events · **Type:** Feature · **Priority:** P3 · **Size:** M–L in total
- Each of these can become its own issue once scoped:
  - **Editable host:** the host can't be changed after an event is created. This touches author checks and RSVP ties to the host.
  - **Private/Public choice:** replace the "Public event" toggle with a clear Private/Public choice, with invitees picked at draft time.
  - **Co-hosting:** naming and credit only (the main host keeps control), instant add, the co-host can remove themselves, and the event is listed under the co-host while active. Build the co-host notification with a working deep link from the start.
  - **Tag filtering:** search and filter events by tag (extends the existing category filter).
  - **Review notification link:** the "event submitted for review" notification needs a link to the event. It's paired with a silent no-op in the function that sends it.

---

## Messaging and venues

### 23. Hosts reply as the venue
- **Area:** Messaging, Venues · **Type:** Feature · **Priority:** P2 · **Size:** M–L
- **Problem:** A guest pressing "Message the organisers" reaches the one person who confirmed them, not the venue.
- **Proposal:** Build on the existing booking enquiry: a group conversation between the guest and all the venue's admins, linked to the venue. Showing the venue itself as the sender is a separate, larger step.
- **Done when:** A guest's message reaches all the venue's admins, and any of them can answer.

### 24. Message a host without revealing who they are
- **Area:** Messaging, Privacy · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Problem:** Home hosts and people making offers may not want their personal profile revealed to everyone who sends an enquiry.
- **Proposal:** Conversations go through the venue, home profile or offer, without revealing the host's personal account until they choose to.
- **Done when:** A guest can message a home venue or an offer, and the host's personal identity stays hidden unless the host shares it.
- **Note:** Design together with item 23. This is also the foundation for Secret Soirées (item 55).

### 25. Contact form on booking details
- **Area:** Venues, Bookings · **Type:** Feature · **Priority:** P3 · **Size:** S–M
- **Proposal:** A contact form in a venue's "View booking details" that sends a booking enquiry, so artists don't need the venue's email address.
- **Done when:** An artist can send an enquiry from the booking section, and it lands with the venue's admins.

### 26. Show "Deleted account" in old conversations
- **Area:** Messaging · **Type:** Bug · **Priority:** P3 · **Size:** S
- **Problem:** A conversation with a deleted account shows a raw internal ID as its name ("dm-644b5…").
- **Done when:** Such conversations show "Deleted account" with a neutral avatar, and no raw IDs appear in the Messages list.

### 27. Venue-like setup for pop-up and private-home profiles
- **Area:** Profiles, Venues · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Problem:** Pop-up venues and private homes host events, but don't get the venue setup (events, followers, booking details, capacity, facilities).
- **Proposal:** Give them a venue-like setup with simpler options, adjusted for privacy (item 30). Decide together with item 55 whether they become full venues or use stand-alone events.
- **Done when:** A private-home profile can host regular events with followers, like a venue.

### 28. Venue option at signup
- **Area:** Accounts, Onboarding · **Type:** Feature · **Priority:** P2 · **Size:** S–M
- **Problem:** Signup offers only Artist and Fan.
- **Done when:** A new user can choose Venue (and possibly Host) at signup and lands in venue setup.

### 29. Venue settings cleanup
- **Area:** Venues · **Type:** UX · **Priority:** P2 · **Size:** M
- **Proposal:**
  - Add a nav link to Presence/Offers settings.
  - The green "Use Current Location" button looks like "saved": restyle it.
  - End the Venue Identity card cleanly; move Room & Capacity and similar into a collapsible "Advanced settings" with its own Save.
  - Show website and Instagram as social-link icons.
  - Make clear where the contact email is used.
  - Overhaul the venue About page.
  - Retire the legacy "Opportunities"/"Needs" fields in Presence settings (platform-wide decision).
- **Done when:** Agreed with Tim in a short design review, then applied.

---

## Map, Discover and spaces

### 30. Area instead of a pin, with a written location
- **Area:** Events, Map, Offers, Spaces · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Problem:** Private venues, home shows and offers need to show roughly where they are without giving away the address. Today a host must pick a neutral spot nearby, and randomised offer pins can drift too far. Mapbox has no point for some neighbourhoods (for example Observatory, Cape Town), and a typed location doesn't work.
- **Proposal:**
  - The host chooses "pin or area".
  - An area is a shaded circle (for example 500 m–1 km), placed by the host if possible, always within about 500 m of the real address, and can't be zoomed in on to find a street.
  - A location label written by the host ("Observatory, Cape Town"), shown in place of the looked-up address.
- **Done when:** An event, offer or space set to area shows a circle on the map and the host's label on its page, and the precise coordinates never reach anyone not allowed to see the address.

### 31. Map pills: what deselecting shows
- **Area:** Map · **Type:** UX · **Priority:** P2 · **Size:** S
- **Problem:** Deselecting all pills shows every pin.
- **Proposal:** Show no pins, or only pins relevant to the user (connections, followed artists, events they're attending).
- **Done when:** Agreed behaviour is applied.

### 32. Progressive "Zoom in"
- **Area:** Map · **Type:** UX · **Priority:** P3 · **Size:** S
- **Done when:** Each click on "Zoom in" zooms one step further.

### 33. Discover opens an event in place
- **Area:** Discover · **Type:** UX · **Priority:** P3 · **Size:** S–M
- **Problem:** Opening an event from Discover leaves the Discover view and goes to the venue page.
- **Proposal:** Expand the event in place, like artist profiles, with a link to the full page.
- **Done when:** You can browse several events from Discover without losing your place.

### 34. Discover ordering
- **Area:** Discover · **Type:** Product decision · **Priority:** P3 · **Size:** S–M
- **Proposal:** Agree transparent ordering criteria (for example, artists without songs lower; paying artist members first, see item 47), then apply them. Criteria must be documented publicly.
- **Done when:** Ordering rules are written down and implemented.

### 35. Advanced search for spaces
- **Area:** Spaces · **Type:** Feature · **Priority:** P3 · **Size:** M
- **Done when:** Spaces can be filtered by minimum number of guests and other agreed parameters.

### 36. A venue's offers in the map slider panel
- **Area:** Map, Offers · **Type:** Feature · **Priority:** P3 · **Size:** S–M
- **Done when:** The slider panel for a venue lists its offers (tabs or a list).

### 37. Venues can opt out of the map and search
- **Area:** Venues, Map · **Type:** Feature · **Priority:** P3 · **Size:** S
- **Background:** Personal profiles have a map visibility toggle; venues don't.
- **Done when:** A venue can hide itself from the map and search with a toggle separate from offer visibility.

---

## Offers

### 38. The Meal offer card shows no text
- **Area:** Offers · **Type:** Bug · **Priority:** P2 · **Size:** S
- **Done when:** Meal offer cards show their title and details like other offer types. Check the other types at the same time.

### 39. The "Add offer" button looks disabled
- **Area:** Offers · **Type:** UI · **Priority:** P2 · **Size:** S
- **Done when:** It looks like the other main action buttons.

### 40. All offer types for venues
- **Area:** Offers, Venues · **Type:** Feature · **Priority:** P3 · **Size:** S–M
- **Problem:** Only personal profiles can make offers, but some venues can offer a bed, a meal or more to visiting artists. The offers editor only renders for personal profiles, and the offer pin query only looks at them.
- **Proposal:** A UI path for venues, a decision on offer visibility for venues, and a widened pin query. (Offers stay strictly free.)
- **Done when:** A venue can create any offer type, including a bed.

---

## Profiles, accounts and general UI

### 64. Invite existing followers as admins
- **Area:** Circles, Admins · **Type:** UX · **Priority:** P1–P2 · **Size:** S–M
- **Problem:** Invite Admin refuses anyone who already follows the circle ("use Edit User Groups on their row instead"). Being a follower says nothing about whether someone should be an admin, and the roundabout route frustrates users.
- **Proposal:** Drop the follower block in both places it exists. Inviting a follower sends the normal invitation, and accepting it adds the offered roles to their existing ones. Editing roles from the Followers list stays as a second option.
- **Done when:** A follower can be invited as admin or moderator from Invite Admin, and gets the role after accepting.

### 65. Transfer creatorship
- **Area:** Circles, Admins · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Background:** The creator of a circle can't leave it or give up the admin role, and only a superadmin can change that. The team will create profiles for artists and needs to hand full control over when the artist joins (item 61).
- **Proposal:**
  - The creator can transfer creatorship to another admin, who must accept.
  - A superadmin can do the same from the Admin panel, since superadmins have no way into the settings of circles they're not in.
  - The former creator then becomes a normal admin and can leave.
- **Done when:** Creatorship can be handed over by the creator or a superadmin, the "Creator" label moves with it, and it's done before item 61 starts.

### 41. Artists can switch Pledges off
- **Area:** Artist settings · **Type:** Feature · **Priority:** P2 · **Size:** S
- **Done when:** Pledges have an on/off toggle in Modules, like Crew.

### 42. "Preview as visitor"
- **Area:** Profiles, Privacy · **Type:** Feature · **Priority:** P2 · **Size:** M
- **Done when:** A user can see exactly what their profile looks like to a signed-in stranger and to a signed-out visitor.

### 43. Profile completion nudge
- **Area:** Onboarding · **Type:** UX · **Priority:** P2 · **Size:** S
- **Done when:** Unverified personal profiles see a persistent "2 more steps to complete your profile" banner until done.

### 44. Artist welcome card explainers
- **Area:** Onboarding · **Type:** UX · **Priority:** P3 · **Size:** S
- **Done when:** The artist welcome card explains that band members can be added as admins, and shows the solo vs band default avatars more clearly.

### 45. Small UI fixes
- **Area:** UI · **Type:** UI · **Priority:** P2–P3 · **Size:** S each
  - A "Draft" label on the hero image of draft circles.
  - Clearer selection ticks when adding an admin or moderator.
  - A more distinct "Act as" button in the profile switcher.
  - Hide the Community comment box from people who aren't allowed to comment (the server already blocks them).
  - "Show 1 reply" counts only direct replies: show a depth-aware count or "Show replies".
  - Update the membership/subscription page (after item 47 is decided).
  - Error messages must appear on top of any open dialog, not behind its dimmed background.

### 46. Mobile UI review
- **Area:** UI · **Type:** Review · **Priority:** P2 · **Size:** M
- **Done when:** Main flows (signup, profile setup, map, events, crew) are checked on a phone, and issues filed.

---

## Payments and memberships

### 47. Payments integration (PayPal first)
- **Area:** Payments · **Type:** Feature · **Priority:** P2 · **Size:** L
- **Model:** Fans pay artists or organisers directly. Peerify records each payment to unlock downloads and tickets, then invoices its 10% commission afterwards (music, tickets, fan clubs; tips are commission-free). Trial prices in EUR.
- **Includes:**
  - **Artist membership:** €2.50/month, €6/quarter or €20/year, counted in full as commission credit. Unused credit lapses 12 months after membership ends. Perks: priority visibility in search and a tip jar. Crew stays free for all artists for now; later it becomes a paid perk for new artists only, and existing artists keep it.
  - **Fan membership:** €5/month with priority tickets and no ads. Routing part of it to artists as tips, with Peerify handling payouts, is to be explored later.
  - **Fan clubs:** monthly or yearly, price set by the artist (suggested €5).
  - **Tip jar:** for paying artist members.
  - **On-platform ticketing:** including refund and relisting rules for home shows.
  - **Commission ledger and invoicing.**
- **Status:** A developer brief is to be written before any build.

### 48. Later money features
- **Priority:** P3
  - Ads for non-members only.
  - Business pins for music-aligned local businesses (€10/month).
  - Unlocking Independent circles for paying members.

---

## Platform

### 49. Thumbnail sizes and image formats
- **Area:** Performance · **Type:** Improvement · **Priority:** P2 · **Size:** M
- **Problem:** Full-size images are loaded where thumbnails would do (heroes, avatars, event images, offer photos), which makes pages slow, especially on mobile.
- **Proposal:** Generate a few standard sizes on upload, in WebP or AVIF with a fallback, and use them across cards, lists, avatars and the map. Keep stripping image metadata on every derived image.
- **Done when:** Lists and cards load thumbnails, not originals, and page weight drops noticeably.

### 50. Branding leftovers
- **Area:** Branding · **Type:** Chore · **Priority:** P3 · **Size:** S each
  - An Open Graph image for social sharing.
  - An SVG version of the logo mark.
  - Branded email templates.
  - Landing page stats wired to real database counts, if still hardcoded.

---

## Developer housekeeping

### 51. Fix known test failures
- **Area:** Tests · **Type:** Chore · **Priority:** P3 · **Size:** S–M
- **Problem:** `participation-readiness.test.ts` fails on its own; `altcha.test.ts` fails now and then because of timing.
- **Done when:** The full test sweep passes reliably several times in a row.

### 52. Missing postType in multi-feed posts
- **Area:** Feeds · **Type:** Bug · **Priority:** P3 · **Size:** S
- **Problem:** `getPostsFromMultipleFeeds` returns posts without the `postType` field (the same issue was fixed in Community's own fetch path).
- **Done when:** All returned posts include `postType`.

### 53. Reusable "refresh the list after a preview updates" hook
- **Area:** Refactor · **Type:** Chore · **Priority:** P3 · **Size:** S
- **Background:** The same fix has been made three times (ContentPreview, MobileEventsPanel, EventsPanel).
- **Done when:** One shared hook replaces the three copies.

### 54. Do we have @mentions?
- **Area:** Posts · **Type:** Investigation · **Priority:** P3 · **Size:** S
- **Done when:** We know whether @mentions work on Peerify (Kamooni has them), and an issue is filed if not.

### 66. Admin dashboard messages never appear
- **Area:** Admin · **Type:** Bug · **Priority:** P3 · **Size:** S
- **Problem:** The admin dashboard and the system messages tab use a second toast library whose display isn't mounted anywhere, so their 38 messages never show.
- **Done when:** Those screens use the platform's main toasts, and their messages appear.

---

## Larger initiatives (to plan separately)

### 55. Secret Soirées
- Private events where the host's name stays hidden until a ticket is sold, with identity-safe messaging (item 24).
- Includes visible events with the artist on the bill and an anonymous host, so touring artists don't have to host private shows themselves.
- Decide with this whether pop-ups and private spaces become full venues or use stand-alone events (item 27).
- **Size:** L.

### 56. Asks
- Artist requests to their crew (help with sound check, tickets to sell, borrowing a PA, a spare bed).
- Posted by the circle's admins and moderators only. Every Ask has a "needed by" date; event-linked Asks expire on the event date.
- Others see only "Filled". Comments are off; questions go in the "I can help" note. Details sit in a field only the accepted person sees.
- Later: event tasks mirrored to the crew, and location matching so local crew see local Asks. Location-matched Asks are how a "tour team" along a route forms.
- **Size:** L.

### 57. Past contributions on profiles
- Performed crew tasks appear on the personal profile, with the contributor's consent: who helped at whose event, the contribution and the artist's comments. Never addresses or other personal details.
- **Size:** M.

### 58. New artist roles
- **Music Teachers:** a full role, with booking (and a paywall later).
- **Songwriters:** a discovery layer; royalties and licensing deferred.
- Once these exist, Crew defaults by role (on for solo artists and bands, off for teachers and band members).
- **Size:** L.

### 59. Artist and venue authenticity verification
- Separate from personal proof-of-humanity. Network attestation (a minimum number of verifications), likely gating pledges and payouts against impersonation.
- **Size:** L.

### 60. Help-offer question at signup
- An optional Yes / No / Maybe later question at signup ("Would you help visiting artists?"), leading to Offers.
- Aggregated support figures on the map (x beds, y meals, z lifts) as encouragement for touring artists.
- **Size:** M.

### 61. Draft artist profiles for outreach
- **Status:** On hold pending the open questions below.
- **Idea:** The team pre-makes draft public artist profiles from web research, shares a private preview with each artist, and hands the profile over if they want it.
- **Parts:** an import script (dry run first, no notifications, no search indexing until published); private preview links that expire and can be revoked; handover through creatorship transfer (item 65).
- **Open questions:** Is there a legal basis for storing an artist's details before they agree? Real pictures or default avatars? Preview link expiry, and who can create links?
- **Size:** L (about 6–9 days).

### 62. Fan library and listening feedback
- **Principle:** No playlists: each song is started on its own, to keep listening intentional.
- **Phases:** a single Favorites list first, then user categories; drag-and-drop only if there's demand.
- Explore how listening data could give artists useful, privacy-respecting feedback, as an early step towards the Peerify Player.
- **Size:** M for the Favorites list; the rest needs design.

### 63. Social features (later)
- A follower map with generic icons.
- "Find your friends" by email.
- Couch-surfing between crew members.
- Contacts-only private profiles.
- Per-circle guidelines in the circle wizard.

---

## Long-term roadmap

### Peerify Player (Phase 2, needs its own funding)
- Ownership-based playback that persists without membership.
- Sharing only between two Players in physical proximity, with the artist's consent.
- Transparent listening tracking that feeds artist dividends (recorded plays only).
- Gentle, dismissible nudges to support artists you listen to often.

### Phase 1 MVP
- Full multi-role accounts (artist, fan, venue), calendar discovery, digital flyers, a reputation and trust layer, booking and pledge flows, and a direct sales marketplace.

### Deliberately postponed past the MVP
- Advertising engine and sponsor branding on flyers.
- Native mobile app.
- Tour-routing optimisation.
- Merch logistics and complex fan-club billing.
- Royalty and licensing engine, and collecting-society integration.
