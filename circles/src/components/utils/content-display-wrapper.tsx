"use client";

import React, { useEffect } from "react";
import { useAtom } from "jotai";
import { displayedContentAtom, sidePanelSearchStateAtom } from "@/lib/data/atoms";
import { Content } from "@/models/models";

interface ContentDisplayWrapperProps {
    content: Content[];
    children: React.ReactNode;
}

const ContentDisplayWrapper: React.FC<ContentDisplayWrapperProps> = ({ content, children }) => {
    const [, setDisplayedContent] = useAtom(displayedContentAtom);
    const [searchState] = useAtom(sidePanelSearchStateAtom);

    useEffect(() => {
        // Skip while a client-side search/filter is active (or in flight) — map-explorer.tsx
        // owns displayedContentAtom in that case, and overwriting it here with the server's
        // unfiltered content races against the genre/date-filtered results.
        if (searchState.hasSearched || searchState.isSearching) {
            return;
        }
        setDisplayedContent(content);
    }, [content, setDisplayedContent, searchState.hasSearched, searchState.isSearching]);

    return <>{children}</>;
};

export default ContentDisplayWrapper;
