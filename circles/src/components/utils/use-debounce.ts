import _ from "lodash";
import { useCallback, useEffect, useRef } from "react";

export function useDebounce(cb: any, delay: number) {
    const cbRef = useRef(cb);
    // use mutable ref to make useCallback/debounce not depend on `cb` dep
    useEffect(() => {
        cbRef.current = cb;
    });
    return useCallback(
        _.debounce((...args) => cbRef.current(...args), delay),
        [delay],
    );
}
