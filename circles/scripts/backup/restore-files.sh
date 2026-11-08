#!/usr/bin/env bash
# restore-files.sh: file counts and total size, live vs. restored, for the account key files
# (/srv/peerify/data) and the two silo buckets, printed side by side. For the on-box restore check
# (RESTORE-RUNBOOK.md section 6).
#
# READ-ONLY: find, and `mcli ls` with the backup's read-only silo key. It writes, moves and deletes
# nothing. PRINTS NUMBERS ONLY: no file names, object names, DIDs or keys.
#
#   sudo env EXPECT_BOX=prod bash restore-files.sh /var/tmp/peerify-restore-test/restore
#
# The data folder, bucket names and silo alias come from the backup's own config
# (/etc/peerify-backup/backup.conf), so nothing needs editing.
#
# Guards (it refuses to run otherwise):
#   - EXPECT_BOX must match BOX in the backup config, and the host name must be peerify-<BOX>.
#   - The restored folder must be under /var/tmp/peerify-restore-test/ and hold a restored
#     data folder and both buckets.

set -euo pipefail
export LC_ALL=C

CONF_FILE="${CONF_FILE:-/etc/peerify-backup/backup.conf}"
MCLI_DIR="${MCLI_DIR:-/etc/peerify-backup/mcli}"
PREFIX="${RESTORED_PREFIX:-/var/tmp/peerify-restore-test/}"
STATE_DIR="/var/backups/peerify" # where the nightly run keeps its bucket mirror (paths inside the snapshot)

refuse() { echo "Refusing to run: $*" >&2; exit 1; }

R="${1:-}"
[ -n "${EXPECT_BOX:-}" ] || refuse "set EXPECT_BOX to prod or staging."
[ -n "$R" ] || refuse "give the restored folder, e.g. /var/tmp/peerify-restore-test/restore"
case "$PREFIX" in /var/tmp/?*) ;; *) refuse "RESTORED_PREFIX must be under /var/tmp/." ;; esac
case "${R%/}/" in "$PREFIX"?*) ;; *) refuse "the restored folder must be under $PREFIX" ;; esac
[ -r "$CONF_FILE" ] || refuse "can't read $CONF_FILE (run it with sudo)."

# Read the four settings without running the config file.
conf() { sed -n -E "s/^$1=\"([^\"]*)\".*/\1/p" "$CONF_FILE" | tail -n1; }
BOX="$(conf BOX)"
DATA_DIR="$(conf DATA_DIR)"
BUCKETS="$(conf BUCKETS)"
SILO_ALIAS="$(conf SILO_ALIAS)"; SILO_ALIAS="${SILO_ALIAS:-backupro}"

[ "$BOX" = "$EXPECT_BOX" ] || refuse "EXPECT_BOX is '$EXPECT_BOX', but $CONF_FILE is for '$BOX'."
[ "$(hostname)" = "peerify-$BOX" ] || refuse "this is $(hostname), not peerify-$BOX."
[ -n "$DATA_DIR" ] && [ -n "$BUCKETS" ] || refuse "DATA_DIR or BUCKETS missing in $CONF_FILE."
[ -d "$DATA_DIR" ] || refuse "the live data folder $DATA_DIR doesn't exist."
[ -d "$R$DATA_DIR" ] || refuse "no restored data folder at $R$DATA_DIR (was the data snapshot restored?)."
for b in $BUCKETS; do
    [ -d "$R$STATE_DIR/buckets/$b" ] || refuse "no restored bucket $b under $R$STATE_DIR/buckets (was the buckets snapshot restored?)."
done
command -v mcli >/dev/null && command -v jq >/dev/null || refuse "mcli and jq are needed."
# An unknown alias would make mcli list a local folder of that name instead, silently: check it.
mcli --config-dir "$MCLI_DIR" alias list "$SILO_ALIAS" >/dev/null 2>&1 || refuse "no silo alias '$SILO_ALIAS' in $MCLI_DIR."

# Files under a folder: "count bytes".
folder_stats() { find "$1" -type f -printf '%s\n' | awk '{n++; s+=$1} END {printf "%d %d\n", n, s}'; }
# Account key folders: the folders directly under users/.
key_folders() { if [ -d "$1/users" ]; then find "$1/users" -mindepth 1 -maxdepth 1 -type d | wc -l; else echo 0; fi; }
# Objects in a live bucket, through the read-only alias: "count bytes".
# An error line, or no answer at all, counts as a failure (never as an empty bucket).
bucket_stats() {
    local out
    out="$(mcli --config-dir "$MCLI_DIR" --json ls --recursive "$SILO_ALIAS/$1")" || return 1
    printf '%s\n' "$out" | jq -e -s 'any(.[]; .status != "success") | not' >/dev/null || return 1
    printf '%s\n' "$out" | jq -rs '[.[] | select(.type == "file")] | "\(length) \(map(.size) | add // 0)"'
}

mib() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1048576 }'; }
signed() { if [ "$1" -gt 0 ]; then echo "+$1"; else echo "$1"; fi; }
row() { printf '%-26s %10s %10s %8s   %12s %12s %10s  %s\n' "$@"; }
note() { # live restored -> note
    if [ "$1" -eq "$2" ]; then echo ""; elif [ "$1" -gt "$2" ]; then echo "more live"; else echo "MORE IN THE BACKUP"; fi
}

echo "Files: live vs. restored on $(hostname) (box $BOX), $(date -u +%Y-%m-%dT%H:%MZ)"
echo "data folder = $DATA_DIR; buckets read with the backup's read-only key ($SILO_ALIAS)"
echo "Numbers only. diff = live - restored. Sizes in bytes; MiB in the last lines."
echo
row "what" "files live" "restored" "diff" "bytes live" "restored" "diff" ""
row "--------------------------" "----------" "----------" "--------" "------------" "------------" "----------" ""

read -r ln lb <<<"$(folder_stats "$DATA_DIR")"
read -r rn rb <<<"$(folder_stats "$R$DATA_DIR")"
row "data folder" "$ln" "$rn" "$(signed $((ln - rn)))" "$lb" "$rb" "$(signed $((lb - rb)))" "$(note "$ln" "$rn")"
SUMMARY=("data: $(mib "$lb") MiB live, $(mib "$rb") MiB restored")
lk="$(key_folders "$DATA_DIR")"; rk="$(key_folders "$R$DATA_DIR")"
row "  account key folders" "$lk" "$rk" "$(signed $((lk - rk)))" "" "" "" "$(note "$lk" "$rk")"

FAILED=0
for b in $BUCKETS; do
    if ! live="$(bucket_stats "$b")"; then
        row "bucket $b" "?" "" "" "" "" "" "cannot list the live bucket"
        FAILED=1
        continue
    fi
    read -r ln lb <<<"$live"
    read -r rn rb <<<"$(folder_stats "$R$STATE_DIR/buckets/$b")"
    row "bucket $b" "$ln" "$rn" "$(signed $((ln - rn)))" "$lb" "$rb" "$(signed $((lb - rb)))" "$(note "$ln" "$rn")"
    SUMMARY+=("$b: $(mib "$lb") MiB live, $(mib "$rb") MiB restored")
done
echo
printf '%s\n' "${SUMMARY[@]}"
exit "$FAILED"
