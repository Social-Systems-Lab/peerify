#!/usr/bin/env python3
"""check-release-fonts.py - font sanity checks on an assembled release, run by deploy-common.sh's
step_verify_release before 'current' is switched.

Usage: check-release-fonts.py <release-dir>      exit 0 = pass, 1 = fail (reasons on stderr)

1. next/font classes: every __variable_xxxxxx / __className_xxxxxx in the server output must be
   defined in the build's static CSS. On 2026-10-05 prod shipped <html> font classes its CSS didn't
   define (next/font/google got different Google responses in the server and client passes), so
   the site rendered in a fallback serif. The app self-hosts its fonts now and has no such classes,
   so this passes trivially unless someone brings next/font back.
2. Font files: every url() in the built CSS that points at a font file must resolve to a file in
   the release (/_next/static/... -> .next/static, other absolute paths -> public/, relative paths
   -> next to the CSS file). External font URLs fail too: they aren't in the release.
"""

import re
import sys
from pathlib import Path
from urllib.parse import unquote

FONT_CLASS = re.compile(r"__(?:variable|className)_[0-9a-f]{6}(?![0-9a-zA-Z_])")
CSS_URL = re.compile(r"url\(\s*(['\"]?)([^)'\"]*)\1\s*\)")
FONT_EXT = re.compile(r"\.(woff2?|ttf|otf|eot)$", re.IGNORECASE)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-release-fonts.py <release-dir>", file=sys.stderr)
        return 2
    release = Path(sys.argv[1])
    static_dir = release / ".next" / "static"
    server_dir = release / ".next" / "server"
    public_dir = release / "public"

    css_files = sorted(static_dir.rglob("*.css"))
    if not css_files:
        print(f"no CSS found under {static_dir}", file=sys.stderr)
        return 1
    css_text = {path: path.read_text(encoding="utf-8", errors="replace") for path in css_files}
    all_css = "\n".join(css_text.values())
    problems = []

    # 1. next/font classes used by the server output but not defined in any static CSS.
    used = set()
    for path in server_dir.rglob("*"):
        if path.suffix in (".js", ".html", ".rsc", ".body") and path.is_file():
            used.update(FONT_CLASS.findall(path.read_text(encoding="utf-8", errors="replace")))
    undefined = sorted(
        cls for cls in used if not re.search(r"\." + re.escape(cls) + r"(?![0-9a-zA-Z_-])", all_css)
    )
    for cls in undefined:
        problems.append(f"next/font class {cls} is used by the server output but not defined in any static CSS")

    # 2. Font url()s in the built CSS that don't resolve to a file in the release.
    font_urls = 0
    for css_path, text in css_text.items():
        for _, raw in CSS_URL.findall(text):
            url = raw.strip()
            if not url or url.startswith("data:"):
                continue
            path_part = unquote(url.split("#", 1)[0].split("?", 1)[0])
            if not FONT_EXT.search(path_part):
                continue
            font_urls += 1
            if re.match(r"^[a-z][a-z0-9+.-]*:|^//", path_part, re.IGNORECASE):
                problems.append(f"{css_path.name}: external font URL {url} (not in the release)")
                continue
            if path_part.startswith("/_next/static/"):
                target = static_dir / path_part[len("/_next/static/"):]
            elif path_part.startswith("/"):
                target = public_dir / path_part.lstrip("/")
            else:
                target = css_path.parent / path_part
            if not target.is_file():
                problems.append(f"{css_path.name}: font URL {url} -> missing file {target}")

    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        return 1

    print(f"{len(used)} next/font class(es) all defined; {font_urls} font url()(s) all present in the release")
    return 0


if __name__ == "__main__":
    sys.exit(main())
