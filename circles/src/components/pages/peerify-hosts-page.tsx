import Image from "next/image"
import Link from "next/link"
import PeerifyFooter from "@/components/pages/peerify-footer"

// Public /hosts page: the host pilot, in the landing page's dark style. Uses the landing page's
// classes (peerify-landing-page.css) plus a few of its own (peerify-hosts-page.css).

const HOST_PILOT_MAILTO = "mailto:hello@peerify.net?subject=Host%20pilot"
const ART = "/peerify/illustrations"

type HostsArt = {
    src: string
    alt: string
    // Set on a placeholder drawing: what the hand-drawn replacement shows. The replacement keeps the same
    // file name and size, so swapping it in needs no code change; drop this note then.
    standInFor?: string
}

// Every drawing on the page, in one place. hosts/ drawings: light lines on transparent, accents in the
// landing drawings' amber (#ff811b). Cards are 460×200, steps 240×150; the frames fit them uncropped.
const HOSTS_ART = {
    intro: { src: `${ART}/feature-door.svg`, alt: "An open front door to a room lit with string lights" },
    venue: {
        src: `${ART}/hosts/space-venue.svg`,
        alt: "A small stage with a lighting rig, spotlights, speakers and a mic stand",
        standInFor: "Hand-drawn small venue with a stage, sound and lights (460×200)",
    },
    popUp: {
        src: `${ART}/hosts/space-popup.svg`,
        alt: "A café counter and tables under pendant lamps, with a mic stand",
        standInFor: "Hand-drawn café or shop after hours, set up for a show (460×200)",
    },
    home: {
        src: `${ART}/hosts/space-home.svg`,
        alt: "A living room with a fireplace, an armchair, a guitar and a mic stand",
        standInFor: "Hand-drawn living room or garden set up for a show (460×200)",
    },
    step1: {
        src: `${ART}/hosts/step-1-tell-us.svg`,
        alt: "A clipboard checklist with two items ticked",
    },
    step2: {
        src: `${ART}/hosts/step-2-connect.svg`,
        alt: "A house, a plus sign and a map pin with a music note",
    },
    step3: {
        src: `${ART}/hosts/step-3-terms.svg`,
        alt: "Stacks of coins beside a jar labelled 1000",
    },
    step4: {
        src: `${ART}/hosts/step-4-show.svg`,
        alt: "String lights over a guitar, a mic stand and an amp",
    },
    step5: {
        src: `${ART}/hosts/step-5-reviews.svg`,
        alt: "A profile card with four hearts",
    },
    listening: { src: `${ART}/manifesto-lights.svg`, alt: "" },
} satisfies Record<string, HostsArt>

function ArtFrame({ art, className }: { art: HostsArt; className: string }) {
    return (
        <div className={`${className} hostsArt`}>
            <Image src={art.src} alt={art.alt} fill unoptimized />
        </div>
    )
}

const SPACES = [
    {
        art: HOSTS_ART.venue,
        name: "Venues",
        text: "are places built for live music, with a stage, sound and lights.",
    },
    {
        art: HOSTS_ART.popUp,
        name: "Pop-up spaces",
        text: "are cafés after hours, shops, community centres and rooms you can hire: not made for gigs, but able to hold a listening audience.",
    },
    {
        art: HOSTS_ART.home,
        name: "Home & private spaces",
        text: "are living rooms, gardens, garages and shared co-op spaces. For home hosts, your address and identity are never shown publicly on Peerify.",
    },
]

const STEPS: { art: HostsArt; text: string }[] = [
    {
        art: HOSTS_ART.step1,
        text: "Tell us about your space: what kind it is, roughly how many people it holds, and where it is.",
    },
    {
        art: HOSTS_ART.step2,
        text: "We connect you with artists who are touring, or who fans have pledged to bring, near you.",
    },
    {
        art: HOSTS_ART.step3,
        text: "You and the artist agree the terms. You might take a share of the ticket takings, pay the artist a fixed fee and run the door yourself, sell food and drinks, or simply host for the love of it. It’s all good.",
    },
    {
        art: HOSTS_ART.step4,
        text: "You host the show together with the artist and their local crew.",
    },
    {
        art: HOSTS_ART.step5,
        text: "Afterwards, everyone reviews everyone, which builds trust for the next show.",
    },
]

export default function PeerifyHostsPage() {
    return (
        <div className="peerify-home page">
            <header className={"hostsTopBar"}>
                <Link href="/" className={"logoLockup"} aria-label="Peerify home">
                    <Image src="/peerify/logo-mark.png" alt="" width={34} height={34} priority />
                    <div className={"logoText"}>Peer<span>ify</span></div>
                </Link>
            </header>

            {/* ── INTRO ── */}
            <section className={"ideaSection hostsIntro"}>
                <div className={"inner"}>
                    <div className={"twoCol"}>
                        <div className={"textCol"}>
                            <h1 className={"serif"}>Host a show</h1>
                            <p>
                                Some of the best concerts happen in living rooms, gardens and cafés after closing.
                                Peerify helps you open your space for an intimate show, with an audience that’s there
                                to listen.
                            </p>
                        </div>
                        <ArtFrame art={HOSTS_ART.intro} className={"photoFrame"} />
                    </div>
                </div>
            </section>

            {/* ── THREE KINDS OF SPACES ── */}
            <section className={"rolesSection hostsSpaces"}>
                <div className={"inner"}>
                    <h2 className={"serif serifLight"}>Three kinds of spaces</h2>
                    <div className={"rolesGrid"}>
                        {SPACES.map((s) => (
                            <div key={s.name} className={"roleCard"}>
                                <ArtFrame art={s.art} className={"roleImageWrap"} />
                                <div className={"roleBody"}>
                                    <p className={"hostsSpaceText"}>
                                        <strong>{s.name}</strong> {s.text}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── HOW THE PILOT WORKS ── */}
            <section className={"howSection"}>
                <div className={"inner"}>
                    <h2 className={"serif"}>How the host pilot works</h2>
                    <ol className={"hostsSteps"}>
                        {STEPS.map((s, i) => (
                            <li key={i} className={"step hostsStep"}>
                                <ArtFrame art={s.art} className={"hostsStepArt"} />
                                <div className={"stepN"} aria-hidden="true">{String(i + 1).padStart(2, "0")}</div>
                                <p>{s.text}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* ── THE LISTENING RULE ── */}
            <section className={"manifesto-section hostsListening"}>
                <h2 className={"sLabel"}>The listening rule</h2>
                <p className={"quoteBlock"}>
                    Peerify shows are for audiences who came to listen. A café after closing, yes. A restaurant
                    during the dinner rush, no. Our artists are not background music for diners.
                </p>
                <Image src={HOSTS_ART.listening.src} alt={HOSTS_ART.listening.alt} width={1600} height={140} unoptimized className={"manifestoLights"} />
            </section>

            {/* ── WHAT PEERIFY DOES ── */}
            <section className={"trust-section"}>
                <div className={"trust-item hostsNote"}>
                    <h2>What Peerify does, and what it doesn’t</h2>
                    <p>
                        During the pilot, Peerify helps with visibility, introductions to artists, and guidance on
                        running a good show. The event itself is yours: you’re responsible for it, including any local
                        rules on licensing, alcohol, noise and safety where you live.
                    </p>
                </div>
            </section>

            {/* ── JOIN ── */}
            <section className={"cta-section"} id="join">
                <div className={"cta-inner"}>
                    <h2>Join the host pilot</h2>
                    <p className={"cta-intro"}>
                        We’re looking for our first hosts. Email us at{" "}
                        <a href={HOST_PILOT_MAILTO} className={"hostsJoinLink"}>hello@peerify.net</a> with the subject
                        “Host pilot” and tell us a little about your space.
                    </p>
                </div>
            </section>

            <PeerifyFooter />
        </div>
    )
}
