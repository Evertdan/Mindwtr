#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
REPO_ROOT = Path(__file__).resolve().parents[2]
METADATA_PATH = REPO_ROOT / "apps/desktop/src-tauri/linux/Mindwtr.metainfo.xml"
PRERELEASE_VERSION = re.compile(
    r"^(?P<base>[0-9]+\.[0-9]+\.[0-9]+)-(?:rc|beta|alpha|pre|preview)(?:[.-]|$)",
    re.IGNORECASE,
)


def normalized_text(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return " ".join(part.strip() for part in element.itertext() if part.strip())


def child_with_lang(
    parent: ET.Element | None,
    tag: str,
    lang: str | None,
) -> ET.Element | None:
    if parent is None:
        return None

    for child in parent.findall(tag):
        child_lang = child.attrib.get(XML_LANG)
        if lang is None and child_lang is None:
            return child
        if child_lang == lang:
            return child
    return None


def children_with_lang(
    parent: ET.Element | None,
    path: str,
    lang: str | None,
) -> list[ET.Element]:
    if parent is None:
        return []

    children = []
    for child in parent.findall(path):
        child_lang = child.attrib.get(XML_LANG)
        if lang is None and child_lang is None:
            children.append(child)
        elif child_lang == lang:
            children.append(child)
    return children


def combined_text(children: list[ET.Element]) -> str:
    return " ".join(normalized_text(child) for child in children if normalized_text(child))


def require_description_locale(
    errors: list[str],
    parent: ET.Element,
    label: str,
) -> ET.Element | None:
    description = child_with_lang(parent, "description", None)
    if description is None:
        errors.append(f"Missing default English {label}.")
        return None

    if child_with_lang(parent, "description", "de") is not None:
        errors.append(f"German {label} must localize paragraphs/list items, not the description tag.")

    english_paragraphs = children_with_lang(description, "p", None)
    german_paragraphs = children_with_lang(description, "p", "de")
    english_bullets = children_with_lang(description, "ul/li", None)
    german_bullets = children_with_lang(description, "ul/li", "de")

    english_text = combined_text(english_paragraphs + english_bullets)
    german_text = combined_text(german_paragraphs + german_bullets)

    if not combined_text(english_paragraphs):
        errors.append(f"{label} must include at least one default English paragraph.")
    if not combined_text(german_paragraphs):
        errors.append(f"{label} must include at least one German paragraph.")
    if not combined_text(english_bullets):
        errors.append(f"{label} must include at least one default English bullet.")
    if not combined_text(german_bullets):
        errors.append(f"{label} must include at least one German bullet.")
    if german_text and english_text and german_text == english_text:
        errors.append(f"German {label} must not duplicate the English text.")

    return description


def require_translation(
    errors: list[str],
    parent: ET.Element,
    tag: str,
    label: str,
) -> ET.Element | None:
    default_element = child_with_lang(parent, tag, None)
    german_element = child_with_lang(parent, tag, "de")
    default_text = normalized_text(default_element)
    german_text = normalized_text(german_element)

    if not default_text:
        errors.append(f"Missing default English {label}.")
    if not german_text:
        errors.append(f"Missing German {label} with xml:lang=\"de\".")
    elif german_text == default_text:
        errors.append(f"German {label} must not duplicate the English text.")

    return german_element


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate German localization (and, optionally, the top release "
        "entry's version) of the desktop AppStream metainfo.",
    )
    parser.add_argument(
        "--expected-version",
        default=None,
        help="Fail if the top <release version=...> entry does not equal this value. "
        "Omit to skip the check (ordinary, non-release CI runs).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    try:
        root = ET.parse(METADATA_PATH).getroot()
    except FileNotFoundError:
        print(f"Missing AppStream metadata: {METADATA_PATH}", file=sys.stderr)
        return 1
    except ET.ParseError as exc:
        print(f"Invalid AppStream XML: {exc}", file=sys.stderr)
        return 1

    errors: list[str] = []

    require_translation(errors, root, "summary", "summary")

    require_description_locale(errors, root, "AppStream description")

    screenshots = root.find("screenshots")
    if screenshots is None:
        errors.append("Missing AppStream screenshots.")
    else:
        for index, screenshot in enumerate(screenshots.findall("screenshot"), start=1):
            default_caption = child_with_lang(screenshot, "caption", None)
            german_caption = child_with_lang(screenshot, "caption", "de")
            default_text = normalized_text(default_caption)
            german_text = normalized_text(german_caption)
            if not default_text:
                errors.append(f"Screenshot {index} is missing a default English caption.")
            if not german_text:
                errors.append(f"Screenshot {index} is missing a German caption.")
            elif german_text == default_text:
                errors.append(f"Screenshot {index} German caption duplicates English.")

    release_entries = root.findall("./releases/release")
    latest_release = release_entries[0] if release_entries else None
    if latest_release is None:
        errors.append("Missing AppStream releases.")
    else:
        version = latest_release.attrib.get("version", "latest")
        default_release_notes = require_description_locale(errors, latest_release, f"{version} release notes")
        if default_release_notes is not None and default_release_notes.attrib.get("translate") == "no":
            errors.append(f"{version} release notes must not leave the default description marked translate=\"no\".")
        if args.expected_version and version != args.expected_version:
            errors.append(
                f"Top AppStream release entry is {version}, expected {args.expected_version} "
                f"({METADATA_PATH.name}'s top <release> was not updated for this release)."
            )
        if PRERELEASE_VERSION.match(version) is None:
            same_version_prereleases = [
                release.attrib.get("version", "")
                for release in release_entries[1:]
                if (match := PRERELEASE_VERSION.match(release.attrib.get("version", "")))
                and match.group("base") == version
            ]
            if same_version_prereleases:
                errors.append(
                    f"Stable AppStream release {version} must replace its prerelease entries; "
                    f"Flathub sorts these after the stable version: {', '.join(same_version_prereleases)}."
                )

    if errors:
        print("AppStream German locale validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("AppStream German locale validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
