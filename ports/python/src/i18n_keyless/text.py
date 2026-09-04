"""The pure text rules of the protocol: storage key, queue id, namespace, ``replace``.

Ports of the helpers in ``packages/core/service.ts``, replayed against
``conformance/vectors/storage-key.json``, ``queue.json``, ``namespace.json`` and
``replace.json``.
"""

from __future__ import annotations

import re
from typing import Mapping, Optional

#: The reserved namespace, never written on the wire (no body field, no query parameter).
DEFAULT_NAMESPACE = "default"


def storage_key_for(key: str, context: Optional[str] = None) -> str:
    """The key a translation is stored under: the source text, ``__<context>`` appended.

    An empty context is no context. Nothing is escaped: a source text containing ``__`` is
    ambiguous by design, in every SDK alike.
    """
    return f"{key}__{context}" if context else key


def queue_id_for(namespace: str, key: str) -> str:
    """The id that deduplicates translate requests: one per (namespace, source text).

    The context and the origin language are deliberately not part of it (PROTOCOL.md,
    section 15, item 1): two contexts of one key in one batch produce one request.
    """
    return f"{namespace}:{key}"


def resolve_namespace(namespace: Optional[str], default_namespace: Optional[str]) -> str:
    """A per-call namespace wins, then the config default, then the literal ``default``."""
    return namespace or default_namespace or DEFAULT_NAMESPACE


def resolve_origin_language(origin_language: Optional[str], primary: str) -> Optional[str]:
    """The origin language of a user-written key, or ``None`` for the regular flow.

    An origin equal to the primary language is the regular flow, so it is dropped here and
    never travels.
    """
    if not origin_language or origin_language == primary:
        return None
    return origin_language


def apply_replace(text: str, replace: Optional[Mapping[str, str]]) -> str:
    """Apply the ``replace`` option to a text, exactly like the JavaScript SDKs.

    Every placeholder is a literal (regex metacharacters are escaped), all placeholders are
    matched in one left-to-right pass in the map's order, each occurrence is replaced, the
    replacement is inserted verbatim and never re-scanned, and a placeholder whose
    replacement is empty is left in place.
    """
    if not replace:
        return text
    pattern = "|".join(re.escape(placeholder) for placeholder in replace)
    return re.sub(pattern, lambda match: replace[match.group(0)] or match.group(0), text)
