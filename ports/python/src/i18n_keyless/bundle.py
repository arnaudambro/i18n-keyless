"""The precompiled bundle (PROTOCOL.md, sections 4.5 and 7.4).

A directory exported at build time by the MCP ``export_bundle`` tool or from
``GET /translate/bundle``: ``manifest.json`` plus one ``<namespace>/<lang>.json`` per
dictionary. Pointed at it (``Config.bundle_path``), :meth:`I18nKeyless.init` reads every
dictionary the manifest lists into the store and skips the boot fetch of a namespace the
manifest covers. Nothing else changes: a miss still POSTs, and the refetch that follows a
batch of misses still runs.

The two rules are pure and replayed by ``conformance/vectors/bundle-seed.json``:
:func:`bundle_covers` and :func:`merge_bundle_with_storage`.
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union

log = logging.getLogger("i18n_keyless")

#: The parsed ``manifest.json``: the bundle without its dictionaries.
BundleManifest = Mapping[str, Any]

PathLike = Union[str, "os.PathLike[str]"]


class BundleError(ValueError):
    """``manifest.json`` is missing or is not a manifest. Raised by :func:`read_manifest`."""


@dataclass(frozen=True)
class BundleSeed:
    """The seed of one namespace: a dictionary and the cursor that goes with it."""

    translations: Dict[str, str]
    last_refresh: Optional[str]


@dataclass(frozen=True)
class StoredSeed:
    """What storage holds for one namespace: its slice, its cursor and the language it is in."""

    translations: Dict[str, str]
    last_refresh: Optional[str]
    lang: str


def bundle_covers(manifest: Optional[BundleManifest], namespace: str, lang: str) -> bool:
    """True when the manifest lists ``lang`` under ``namespace``."""
    if not isinstance(manifest, Mapping):
        return False
    namespaces = manifest.get("namespaces")
    entry = namespaces.get(namespace) if isinstance(namespaces, Mapping) else None
    if not isinstance(entry, Mapping):
        return False
    languages = entry.get("languages")
    return isinstance(languages, list) and lang in languages


def bundle_namespaces(manifest: Optional[BundleManifest]) -> List[str]:
    """The namespaces the manifest lists, in manifest order."""
    if not isinstance(manifest, Mapping) or not isinstance(manifest.get("namespaces"), Mapping):
        return []
    return list(manifest["namespaces"])


def bundle_covers_namespace(manifest: Optional[BundleManifest], namespace: str) -> bool:
    """True when the manifest covers ``namespace`` in at least one language (the node rule):
    the boot fetch of that namespace is then skipped, the bundle already seeded it."""
    return any(bundle_covers(manifest, namespace, lang) for lang in bundle_languages(manifest, namespace))


def bundle_languages(manifest: Optional[BundleManifest], namespace: str) -> List[str]:
    """The languages the manifest lists under ``namespace`` (the files that exist)."""
    if not isinstance(manifest, Mapping) or not isinstance(manifest.get("namespaces"), Mapping):
        return []
    entry = manifest["namespaces"].get(namespace)
    languages = entry.get("languages") if isinstance(entry, Mapping) else None
    return [lang for lang in languages if isinstance(lang, str)] if isinstance(languages, list) else []


def bundle_last_refresh(manifest: BundleManifest, namespace: str) -> Optional[str]:
    """The cursor of one namespace of the manifest, or ``None``."""
    entry = manifest.get("namespaces", {}).get(namespace) if isinstance(manifest.get("namespaces"), Mapping) else None
    cursor = entry.get("lastRefresh") if isinstance(entry, Mapping) else None
    return cursor if isinstance(cursor, str) else None


def _cursor(value: Any) -> Optional[float]:
    """A cursor as a finite number, or ``None``: JavaScript's ``Number()`` for the values a
    cursor can hold. An empty or missing cursor is never a number."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def merge_bundle_with_storage(bundle: BundleSeed, stored: Optional[StoredSeed], lang: str) -> BundleSeed:
    """The precedence between the bundle and what storage holds for the same namespace.

    The bundle is the base. Storage wins (its keys on top, its cursor kept) only when it is
    strictly newer, its cursor a larger number than the bundle's, AND it is in the language
    being seeded. Anything else answers the bundle unchanged: a slice in another language, an
    equal or older cursor, an empty, ``None`` or non-numeric cursor.
    """
    if stored is None or stored.lang != lang:
        return bundle
    stored_cursor = _cursor(stored.last_refresh)
    bundle_cursor = _cursor(bundle.last_refresh)
    if stored_cursor is None or bundle_cursor is None or not stored_cursor > bundle_cursor:
        return bundle
    return BundleSeed({**bundle.translations, **stored.translations}, stored.last_refresh)


def read_manifest(bundle_path: PathLike) -> Dict[str, Any]:
    """Parse ``<bundle_path>/manifest.json``. A missing or malformed file is a
    :class:`BundleError`: the path is configuration, and a wrong one must not pass silently."""
    path = Path(bundle_path) / "manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise BundleError(f"i18n-keyless: no manifest.json in the bundle directory {Path(bundle_path)}") from None
    except (OSError, ValueError) as error:
        raise BundleError(f"i18n-keyless: cannot read the bundle manifest {path}: {error}") from error
    if not isinstance(manifest, dict) or not isinstance(manifest.get("namespaces"), dict):
        raise BundleError(f"i18n-keyless: {path} is not a bundle manifest (no `namespaces` object)")
    return manifest


def read_bundle_file(bundle_path: PathLike, namespace: str, lang: str) -> Optional[Dict[str, str]]:
    """The dictionary of ``<bundle_path>/<namespace>/<lang>.json``, or ``None`` when the file
    is missing or is not a dictionary (logged: the pair is then treated as not covered)."""
    path = Path(bundle_path) / namespace / f"{lang}.json"
    try:
        dictionary = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        log.error("i18n-keyless: bundle file %s cannot be read: %s", path, error)
        return None
    if not isinstance(dictionary, dict):
        log.error("i18n-keyless: bundle file %s is not a dictionary", path)
        return None
    return {key: text for key, text in dictionary.items() if isinstance(key, str) and isinstance(text, str)}
