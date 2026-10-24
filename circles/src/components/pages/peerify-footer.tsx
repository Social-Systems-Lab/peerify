import Image from "next/image"
import Link from "next/link"

// Footer shared by the landing page and /hosts. Styled by peerify-landing-page.css, so it must sit
// inside a .peerify-home wrapper.
export default function PeerifyFooter() {
    return (
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
    )
}
