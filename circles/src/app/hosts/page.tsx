// \app\hosts\page.tsx - public host pilot page (no login), in the landing page's dark style
import "@/components/pages/peerify-landing-page.css";
import "@/components/pages/peerify-hosts-page.css";
import type { Metadata } from "next";
import PeerifyHostsPage from "@/components/pages/peerify-hosts-page";

export const metadata: Metadata = { title: "Host a show" };

export default function HostsPage() {
    return <PeerifyHostsPage />;
}
