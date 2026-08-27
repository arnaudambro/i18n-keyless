#!/bin/sh
# Per-file line coverage of lib/, without lcov. Run from ports/flutter.
cd "$(dirname "$0")/.." && flutter test --coverage >/dev/null && awk -F'[:,]' '/^SF:/{f=$2} /^LH:/{lh=$2} /^LF:/{lf=$2} /^end_of_record/{printf "%-50s %4d/%-4d %6.1f%%\n", f, lh, lf, 100*lh/lf; tlh+=lh; tlf+=lf} END{printf "%-50s %4d/%-4d %6.1f%%\n", "TOTAL", tlh, tlf, 100*tlh/tlf}' coverage/lcov.info
