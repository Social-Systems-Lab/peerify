"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAtom } from "jotai"
import { userAtom } from "@/lib/data/atoms"
import { getCircleDefaultPath } from "@/lib/utils/circle-routes"
import PeerifyContactDialog from "@/components/pages/contact/peerify-contact-dialog"
import { CreatePeerifyArtistDialog } from "@/components/global-create/create-peerify-artist-dialog"

// ─── Stats ────────────────────────────────────────────────────────────────────
// TODO: replace with appConfig.stats once wired to the database
// import { appConfig } from "@/config/app"
const STATS = {
    artists: 847,
    members: 2341,
    venues: 134,
}
// TODO: restore the stat block on the CTA section once we have real numbers to show — flip back to true
const SHOW_CTA_STATS = false

// Venue/host signup isn't a real flow yet (/signup/pilot has no venue option and no
// dedicated route) — hiding these entry points until that flow exists is intentional,
// not a bug. Flip back to true once venue signup is built.
const SHOW_VENUE_SIGNUP = false

// ─── Feature cards ────────────────────────────────────────────────────────────
const FEATURES = [
    {
        tag: "Fans & artists",
        title: "Map-based discovery",
        body: "Browse artists worldwide or filter by your city, genre, or touring status. See tour pledges building in real time. No algorithm — just geography and music.",
        art: "feature-map.svg",
        alt: "A folded map with pins and a dotted route to a house",
    },
    {
        tag: "The core mechanic",
        title: "Pledge to bring them here",
        body: "Found an artist you want to bring to your city? Start or join a tour pledge. When it tips, a tour team forms and the show moves from possibility to plan.",
        art: "feature-pledge.svg",
        alt: "A pledge jar filling up with coins towards a flag",
    },
    {
        tag: "Fair economics",
        title: "Buy music directly",
        body: "Peerify is not a streaming site. When you buy music here, it’s yours. The artist receives 90% of the price. Paying members give €5 a month, and €4 of it goes straight to artists as music credit.",
        art: "feature-vinyl.svg",
        alt: "A record sliding out of its sleeve beside a cassette",
    },
    {
        tag: "Coming soon",
        title: "The Peerify Player",
        body: "Your personal collection. When you’re in close proximity to another listener, you can share the music you own with them. All plays are recorded, and Peerify surplus becomes royalties for the artists.",
        art: "feature-player.svg",
        alt: "Two phones held side by side, sharing a song",
    },
    {
        tag: "Tour support",
        title: "Join the tour team",
        body: "When a tour pledge hits 10%, a tour team forms. Offer a spare room, a meal, transport, or a stage. Community makes tours possible, and you get to make new friends along the way.",
        art: "feature-crew.svg",
        alt: "A small car with a guitar case strapped to the roof",
    },
    {
        tag: "Home hosting",
        title: "Host a house concert",
        body: "Open your living room to live music. Set the capacity, vet your guests, and share the address only with people you’ve approved. Intimate music in the places it belongs.",
        art: "feature-door.svg",
        alt: "An open front door to a room lit with string lights",
    },
]

// ─── Steps ────────────────────────────────────────────────────────────────────
const STEPS = [
    { n: "01", art: "step-1-discover.svg", alt: "A globe dotted with location pins", title: "Discover on the map",    body: "Browse artists worldwide or filter by your city, genre, or touring status. Find someone whose music you love and who hasn’t played near you yet." },
    { n: "02", art: "step-2-pledge.svg",   alt: "A hand dropping coins into a pledge jar", title: "Pledge to bring them",   body: "Start or join a tour pledge. Watch it grow. When it tips, a tour team forms and the show moves from possibility to real life." },
    { n: "03", art: "step-3-host.svg",     alt: "Someone on a step stool hanging string lights", title: "Help make it happen",    body: "Offer a spare room, a meal, transport, or a space to play. Join the Crew and build the tour together with the artists. Peer-to-peer all the way through." },
    { n: "04", art: "step-4-perform.svg",  alt: "An artist playing guitar to a small seated audience", title: "Show up & support", body: "Attend the show, buy the record, spread the word. Meet new people, make new friends, and share an intimate, magical evening that couldn’t happen any other way." },
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function PeerifyLandingPage() {
    const [user] = useAtom(userAtom)
    const router = useRouter()
    const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false)

    // Logged-in users already have a personal account — clicking "Create an artist
    // profile" should open the same managed-identity flow as the global Create
    // button, not send them through pilot signup again.
    const handleArtistIdentityCreated = (data?: { id?: string; circleHandle?: string }) => {
        const handle = data?.circleHandle ?? data?.id
        if (handle) {
            router.push(`/circles/${handle}/home`)
        }
    }

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible") }),
            { threshold: 0.1 }
        )
        document.querySelectorAll(`.${"reveal"}`).forEach((el) => observer.observe(el))
        return () => observer.disconnect()
    }, [])

    return (
        <div className="peerify-home page">

            {/* ── HERO ── */}
            <section className={"hero"}>
                <div className={"heroBg"} />
                <div className={"heroInner"}>
                    <div className={"logoLockup"}>
                        <Image src="/peerify/logo-mark.png" alt="Peerify mark" width={42} height={42} priority />
                        <div className={"logoText"}>Peer<span>ify</span></div>
                    </div>
                    <h1 className={"heroHeading"}>
                        The next stage<br />of <em>music.</em>
                    </h1>
                    <p className={"heroSub"}>
                        A peer-to-peer, non-profit platform connecting artists, fans, and living rooms.
                        Browse artists on a map. Pledge to bring them to your city. Host a show at home.
                    </p>
                    <div className={"heroActions"}>
                        <Link href="/discover" className={"btnOrange"}>Discover your next favourite song</Link>
                        {user ? (
                            <Link href={getCircleDefaultPath(user)} className={"btnGhost"}>Go to profile</Link>
                        ) : (
                            <Link href="/signup/pilot" className={"btnGhost"}>Join Peerify</Link>
                        )}
                    </div>
                </div>
            </section>

            {/* ── THE IDEA ── */}
            <section className={"ideaSection reveal"} id="discover">
                <div className={"inner"}>
                    <div className={"twoCol"}>
                        <div className={"textCol"}>
                            <p className={"sLabel"}>The idea</p>
                            <h2 className={"serif"}>1,000 fans is all it takes</h2>
                            <p>Streaming pays fractions of a cent per play. Touring rarely breaks even. But an artist doesn&apos;t need to go viral &mdash; they need a thousand people who actually show up, buy the music, and open their homes. Peerify is the infrastructure for finding those people, and turning their support into a real, sustainable career.</p>
                            <Link href="/explore" className={"btnOrange"} style={{ marginTop: "8px" }}>Explore artists on the map</Link>
                        </div>
                        <div className={"photoFrame"}>
                            <Image src="/peerify/illustrations/idea-ticket.svg" alt="A pile of hand-numbered gig tickets, with No. 1000 on top" fill unoptimized className={"photoImg"} />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── FEATURES ── */}
            <section className={"featuresSection reveal"} id="features">
                <div className={"inner"}>
                    <p className={"sLabel"}>What makes Peerify different</p>
                    <h2 className={"serif"}>Discovery, support,<br />connections and community.</h2>
                    <div className={"featuresGrid"}>
                        {FEATURES.map((f) => (
                            <div key={f.title} className={"featureCard"}>
                                <div className={"featureArt"}>
                                    <Image src={`/peerify/illustrations/${f.art}`} alt={f.alt} fill unoptimized className={"featureImg"} />
                                </div>
                                <h3>{f.title}</h3>
                                <p>{f.body}</p>
                                <span className={"featureTag"}>{f.tag}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── ROLES ── */}
            <section className={"rolesSection reveal"} id="artists">
                <div className={"inner"}>
                    <p className={"sLabel"} style={{ color: "#e8720c" }}>Growing Peerify</p>
                    <h2 className={"serif serifLight"}>The roles you can play.</h2>
                    <div className={SHOW_VENUE_SIGNUP ? "rolesGrid" : "rolesGrid rolesGrid--twoUp"}>

                        <div className={"roleCard"}>
                            <div className={"roleImageWrap"}>
                                <Image src="/peerify/illustrations/role-artist.svg" alt="An artist carrying a guitar case towards a house with a lit window" fill unoptimized className={"roleImg"} />
                            </div>
                            <div className={"roleBody"}>
                                <p className={"roleType"}>For Artists</p>
                                <h3>Micro-gigs, home concerts &amp; community-backed touring</h3>
                                <ul>
                                    <li>Earn 90% on every music and ticket sale</li>
                                    <li>Let fans pledge tours into existence</li>
                                    <li>Fan-club tools &amp; direct messaging</li>
                                    <li>Build a dedicated crew around the world</li>
                                </ul>
                                {user ? (
                                    <button
                                        type="button"
                                        className={"roleCta"}
                                        style={{ border: "none", background: "none", cursor: "pointer" }}
                                        onClick={() => setIsArtistDialogOpen(true)}
                                    >
                                        Create an artist profile &rarr;
                                    </button>
                                ) : (
                                    <Link href="/signup/pilot?role=artist" className={"roleCta"}>Create an artist profile &rarr;</Link>
                                )}
                            </div>
                        </div>

                        <div className={"roleCard"}>
                            <div className={"roleImageWrap"}>
                                <Image src="/peerify/illustrations/role-fan.svg" alt="Fans sitting around an artist playing in a living room" fill unoptimized className={"roleImg"} />
                            </div>
                            <div className={"roleBody"}>
                                <p className={"roleType"}>For Fans</p>
                                <h3>Discover, support &amp; experience music differently</h3>
                                <ul>
                                    <li>Pledge to bring artists to your city</li>
                                    <li>Attend intimate house concerts</li>
                                    <li>Join an artist&apos;s Crew</li>
                                    <li>Help co-create Peerify</li>
                                </ul>
                                {user ? (
                                    <Link href={getCircleDefaultPath(user)} className={"roleCta"}>Go to profile &rarr;</Link>
                                ) : (
                                    <Link href="/signup/pilot?role=fan" className={"roleCta"}>Create a fan profile &rarr;</Link>
                                )}
                            </div>
                        </div>

                        {SHOW_VENUE_SIGNUP && (
                            <div className={"roleCard"}>
                                <div className={"roleImageWrap"}>
                                    <Image src="/peerify/illustrations/role-host.svg" alt="A host carrying an amp into a room under string lights" fill unoptimized className={"roleImg"} />
                                </div>
                                <div className={"roleBody"}>
                                    <p className={"roleType"}>For Hosts &amp; Venues</p>
                                    <h3>Open your space to living music</h3>
                                    <ul>
                                        <li>Private events with guest vetting</li>
                                        <li>10% on tickets, invoiced after the event</li>
                                        {/* Was "List on the map &amp; accept bookings" — restore when
                                            PEERIFY_BOOKING_ENQUIRIES_ENABLED goes back on. */}
                                        <li>List your venue on the map</li>
                                        <li>No membership fee to get started</li>
                                    </ul>
                                    <Link href="/signup/pilot" className={"roleCta"}>List your space &rarr;</Link>
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </section>

            {/* ── FOR HOSTS ── */}
            <section className={"hostsSection reveal"} id="hosts">
                <div className={"inner"}>
                    <div className={"twoCol"}>
                        <div className={"photoFrame"}>
                            <Image src="/peerify/illustrations/role-host.svg" alt="A host carrying an amp into a room under string lights" fill unoptimized className={"photoImg"} />
                        </div>
                        <div className={"textCol"}>
                            <p className={"sLabel"}>For hosts</p>
                            <h2 className={"serif hostsHeading"}>Open your living room, garden, café or community space for an intimate, trusted show.</h2>
                            <ul className={"hostsList"}>
                                <li>Offer a space where people come to really listen</li>
                                <li>Shape the evening together with the artist and their crew</li>
                                <li>Share in the takings if you want to</li>
                                <li>Bring live music to your neighbourhood</li>
                            </ul>
                            <Link href="/hosts" className={"btnOrange"}>Join the host pilot</Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ── */}
            <section className={"howSection reveal"} id="how">
                <div className={"inner"}>
                    <p className={"sLabel"}>How it works</p>
                    <h2 className={"serif"}>Discover &rarr; Pledge &rarr; Host &rarr; Perform</h2>
                    <div className={"steps"}>
                        {STEPS.map((s) => (
                            <div key={s.n} className={"step"}>
                                <div className={"stepArt"}>
                                    <Image src={`/peerify/illustrations/${s.art}`} alt={s.alt} fill unoptimized className={"stepImg"} />
                                </div>
                                <div className={"stepN"}>{s.n}</div>
                                <h4>{s.title}</h4>
                                <p>{s.body}</p>
                            </div>
                        ))}
                    </div>
                    <div className={"playerBlock"}>
                        <div className={"playerCircle"}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <polygon points="8,6 8,18 19,12" fill="none" stroke="#e8720c" strokeWidth="1.5" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <div>
                            <h4>Coming soon: The Peerify Player</h4>
                            <p>A proximity-based player that lets you meet new people nearby and share music you have purchased on Peerify. All plays are recorded, allowing Peerify to return its surplus to artists as dividends based on listening.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── MANIFESTO ── */}
            <section className={"manifesto-section reveal"}>
                <blockquote>
                    &ldquo;Music was never meant to be a stream of anonymous plays listened to alone.
                    It&apos;s a room, a couch, a song, <em>a space where strangers become friends</em>.&rdquo;
                </blockquote>
                <p className={"manifesto-attr"}>&mdash; The Peerify thesis</p>
                <Image src="/peerify/illustrations/manifesto-lights.svg" alt="" width={1600} height={140} unoptimized className={"manifestoLights"} />
            </section>

            {/* ── TRUST ── */}
            <section className={"trust-section reveal"} id="about">
                <div className={"trustGrid"}>
                    <div className={"trust-item"}>
                        <strong>Non-profit</strong>
                        <span>Peerify is owned by Social Systems Foundation. All surplus returns to artists and the community.</span>
                    </div>
                    <div className={"trust-item"}>
                        <strong>Human music only</strong>
                        <span>This platform is for human artists, full stop. No AI-generated content, ever.</span>
                    </div>
                    <div className={"trust-item"}>
                        <strong>Open by design</strong>
                        <span>You own your audience. Your data is yours. No lock-in, no extractive terms, no algorithms obscuring your fans.</span>
                    </div>
                </div>
            </section>

            {/* ── CTA ── */}
            <section className={"cta-section reveal"} id="join">
                <div className={"cta-inner"}>
                    <h2>Keen to help build and grow Peerify?</h2>
                    <p className={"cta-intro"}>
                        We are looking for 500 artists and fans to populate the map and test the features.
                        Keen to join now and help shape Peerify?
                    </p>
                    {SHOW_CTA_STATS && (
                        <div className={"bigStats"}>
                            <div className={"bigStat"}>
                                <div className={"bigStatN"}>{STATS.artists.toLocaleString()}</div>
                                <div className={"bigStatL"}>Artists</div>
                            </div>
                            <div className={"bigStat"}>
                                <div className={"bigStatN"}>{STATS.members.toLocaleString()}</div>
                                <div className={"bigStatL"}>Members</div>
                            </div>
                            <div className={"bigStat"}>
                                <div className={"bigStatN"}>{STATS.venues.toLocaleString()}</div>
                                <div className={"bigStatL"}>Venues</div>
                            </div>
                        </div>
                    )}
                    <div className={"ctaGroup"}>
                        {user ? (
                            <Link href={getCircleDefaultPath(user)} className={"btnDark"}>Go to profile</Link>
                        ) : (
                            <Link href="/signup/pilot?role=fan" className={"btnDark"}>Join as a fan / member</Link>
                        )}
                        {user ? (
                            <button
                                type="button"
                                className={"btnDark"}
                                style={{ border: "none", cursor: "pointer" }}
                                onClick={() => setIsArtistDialogOpen(true)}
                            >
                                Create an artist profile
                            </button>
                        ) : (
                            <Link href="/signup/pilot?role=artist" className={"btnDark"}>Create an artist profile</Link>
                        )}
                        {SHOW_VENUE_SIGNUP && (
                            <Link href="/signup/pilot" className={"btnOutlineDark"}>List a venue or space</Link>
                        )}
                    </div>
                    <div className={"ctaSecondary"}>
                        <p className={"ctaSecondaryText"}>
                            Love the idea and want to help us build it? We&apos;re looking for people with time or
                            skills in tech, ops, or outreach.
                        </p>
                        <PeerifyContactDialog
                            trigger={
                                <button type="button" className={"btnGhostDark"}>
                                    Get in touch
                                </button>
                            }
                        />
                    </div>
                </div>
            </section>

            {/* ── FOOTER ── */}
            <footer className={"footer"}>
                <div className={"footerLogo"}>
                    <Image src="/peerify/logo-mark.png" alt="Peerify mark" width={28} height={28} />
                    <div className={"footerLogoText"}>Peer<span>ify</span></div>
                </div>
                <nav className={"footerLinks"}>
                    <Link href="/signup/pilot">For artists</Link>
                    <Link href="/hosts">For hosts</Link>
                    <Link href="/explore">Explore map</Link>
                    <Link href="/discover">Discover</Link>
                    <Link href="/privacy">Privacy</Link>
                    <Link href="/terms">Terms</Link>
                    <a href="https://peerify.net" target="_blank" rel="noopener noreferrer">peerify.net</a>
                </nav>
                <p className={"footerNote"}>
                    A non-profit project by Social Systems Foundation.<br />
                    &copy; {new Date().getFullYear()} Peerify
                </p>
            </footer>

            <CreatePeerifyArtistDialog
                isOpen={isArtistDialogOpen}
                onOpenChange={setIsArtistDialogOpen}
                onSuccess={handleArtistIdentityCreated}
            />

        </div>
    )
}
