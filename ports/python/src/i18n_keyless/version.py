"""The one shared version of every i18n-keyless SDK and port.

It is also the ``Version`` header sent on every request: the API reads its major to pick
the language-code dialect of its answers (``>= 3`` is v3: ``zh-Hans``, ``cs``). Written by
``scripts/set-version.mjs`` at the repository root; do not edit it by hand.
"""

__version__ = "3.6.1"
