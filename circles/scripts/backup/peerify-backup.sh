#!/usr/bin/env bash
# peerify-backup: the nightly encrypted, off-box backup of one Peerify box (prod or staging).
#
# Installed as /usr/local/sbin/peerify-backup and run as root by peerify-backup.timer. Everything
# about the box is in its config file (default /etc/peerify-backup/backup.conf, see
# backup.conf.prod / backup.conf.staging); the secrets sit next to it, one file each, root-only.
#
# One run makes four restic snapshots, each tagged with its part, the box, and --tag if given:
#   mongo    mongodump of each database (a file, then backed up, then deleted again)
#   data     DATA_DIR (/srv/peerify/data: the account key files and the server key)
#   buckets  a local plain-file mirror of each silo bucket (mcli mirror), then backed up
#   config   app.env, nginx, TLS, silo and mongod config, the PM2 dump, the deployed gitSha
# then forgets every snapshot older than KEEP_DAYS days by calendar date (never more than 30),
# prunes so their data really leaves the bucket, and checks the repository (on DEEP_CHECK_WEEKDAY
# it also downloads and verifies DEEP_CHECK_SUBSET of the data). restic encrypts on this box, so
# only encrypted data is ever sent.
#
# A part that fails doesn't stop the others; retention and the check always run. Any failure
# makes the exit status 1, which makes systemd start peerify-backup-failure.service (an email).
# healthchecks.io gets /start, then success or /fail, so a run that never happens is noticed too.
#
# Usage (as root):
#   peerify-backup                    the nightly run
#   peerify-backup --tag pre-release  the same, with an extra tag (before a release)
#   peerify-backup --dry-run          checks and shows what would happen; writes, sends, deletes nothing
#   peerify-backup --check-config     checks the config and secret files only
#   peerify-backup --snapshots        lists the snapshots
#   peerify-backup --restic ARGS...   runs restic with this box's repository (restore, init, ...)
#   peerify-backup --test-alert       sends a test email and a healthchecks.io /fail ping
#   peerify-backup --notify-failure   used by peerify-backup-failure.service: emails the log tail
#   any of them: --config FILE        another config file
#
# Logs: stdout (the journal under systemd) and LOG_FILE. Lines hold counts, sizes, snapshot ids and
# step names; never secrets, never object names from the buckets.

set -Eeuo pipefail
umask 077

CONFIG_FILE=/etc/peerify-backup/backup.conf
MODE=run
EXTRA_TAG=""
RESTIC_ARGS=()
POSTMARK_URL="${POSTMARK_URL:-https://api.postmarkapp.com/email}"
MAX_KEEP_DAYS=30 # IMY commitment and Cleura DPA: backups are kept 30 days or fewer.

usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
    case "$1" in
        --config) CONFIG_FILE="${2:?--config needs a file}"; shift 2 ;;
        --dry-run) MODE=dry-run; shift ;;
        --tag)
            EXTRA_TAG="${2:?--tag needs a name}"
            [[ "$EXTRA_TAG" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || { echo "--tag: lowercase letters, digits and - only" >&2; exit 2; }
            shift 2 ;;
        --check-config) MODE=check-config; shift ;;
        --snapshots) MODE=snapshots; shift ;;
        --restic) MODE=restic; shift; RESTIC_ARGS=("$@"); break ;;
        --test-alert) MODE=test-alert; shift ;;
        --notify-failure) MODE=notify-failure; shift ;;
        -h | --help) usage; exit 0 ;;
        *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
done

BOX="?"
LOG_FILE=""

log() {
    local line
    line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [$BOX] $*"
    printf '%s\n' "$line"
    if [ -n "$LOG_FILE" ]; then printf '%s\n' "$line" >>"$LOG_FILE" || true; fi
}
die() { log "ERROR: $*"; exit 2; }

# ---------------------------------------------------------------------------------------------
# Config and secret files
# ---------------------------------------------------------------------------------------------

# Owned by whoever runs this (root in real use) and readable by nobody else. The config file is
# sourced, so it gets the same check: a file others can write would be code run as root.
check_private() {
    local path="$1" want_mode="$2" mode owner
    [ -e "$path" ] || die "missing: $path"
    owner="$(stat -c %u "$path")"
    mode="$(stat -c %a "$path")"
    [ "$owner" = "$(id -u)" ] || die "$path must be owned by $(id -un) (is uid $owner)"
    case " $want_mode " in
        *" $mode "*) ;;
        *) die "$path has mode $mode, expected ${want_mode// / or } (chmod ${want_mode%% *} $path)" ;;
    esac
}

load_config() {
    check_private "$CONFIG_FILE" "600 400"
    # The shipped configs say CHANGE-ME where INSTALL.md step 5b fills in the alert addresses. A run
    # with them would pass every other check and send its failure emails nowhere, so refuse it.
    local unset_vars
    unset_vars="$({ grep -E '^[^#]*CHANGE-ME' "$CONFIG_FILE" || true; } | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/' | paste -sd' ' -)"
    if [ -n "$unset_vars" ]; then
        die "$unset_vars still CHANGE-ME in $CONFIG_FILE. Set the alert addresses with INSTALL.md step 5b."
    fi
    # shellcheck source=/dev/null
    . "$CONFIG_FILE"

    : "${SECRETS_DIR:=/etc/peerify-backup}"
    : "${STATE_DIR:=/var/backups/peerify}"
    : "${LOG_FILE:=/var/log/peerify-backup/backup.log}"
    : "${LOCK_FILE:=/run/peerify-backup/lock}"
    : "${RESTIC_CACHE_DIR:=/var/cache/peerify-backup/restic}"
    : "${MONGO_HOST:=127.0.0.1}"
    : "${MONGO_PORT:=27017}"
    : "${SILO_ALIAS:=backupro}"
    : "${KEEP_DAYS:=29}"
    : "${DEEP_CHECK_WEEKDAY:=7}"
    : "${DEEP_CHECK_SUBSET:=10%}"
    : "${BUCKET_SHRINK_GUARD_MIN:=20}"

    local v
    for v in BOX APP_PORT MONGO_DBS MONGO_USER BUCKETS DATA_DIR RESTIC_REPOSITORY ALERT_TO ALERT_FROM; do
        [ -n "${!v:-}" ] || die "$v is not set in $CONFIG_FILE"
    done
    [[ "$BOX" =~ ^(prod|staging)$ ]] || die "BOX must be prod or staging (is '$BOX')"
    [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$KEEP_DAYS" -ge 1 ] && [ "$KEEP_DAYS" -le "$MAX_KEEP_DAYS" ] ||
        die "KEEP_DAYS must be a whole number from 1 to $MAX_KEEP_DAYS (is '$KEEP_DAYS')"
    [[ "$DEEP_CHECK_WEEKDAY" =~ ^[1-7]$ ]] || die "DEEP_CHECK_WEEKDAY must be 1 (Monday) to 7 (Sunday)"
    declare -p CONFIG_PATHS_REQUIRED >/dev/null 2>&1 || CONFIG_PATHS_REQUIRED=()
    declare -p CONFIG_PATHS_OPTIONAL >/dev/null 2>&1 || CONFIG_PATHS_OPTIONAL=()

    mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$LOCK_FILE")" "$STATE_DIR" "$RESTIC_CACHE_DIR"
    chmod 700 "$(dirname "$LOG_FILE")" "$STATE_DIR"
    touch "$LOG_FILE"
    chmod 600 "$LOG_FILE"
}

# The secrets every mode except --notify-failure needs. Only names are checked, never printed.
check_secrets() {
    check_private "$SECRETS_DIR" "700"
    check_private "$SECRETS_DIR/restic.pass" "600 400"
    [ -s "$SECRETS_DIR/restic.pass" ] || die "$SECRETS_DIR/restic.pass is empty"
    check_private "$SECRETS_DIR/s3.env" "600 400"
    if grep -vE '^[[:space:]]*(#|$)' "$SECRETS_DIR/s3.env" | grep -qvE '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)='; then
        die "$SECRETS_DIR/s3.env may only hold AWS_ACCESS_KEY_ID= and AWS_SECRET_ACCESS_KEY= lines"
    fi
    for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
        grep -qE "^$v=.+" "$SECRETS_DIR/s3.env" || die "$SECRETS_DIR/s3.env has no $v"
    done
    check_private "$SECRETS_DIR/mongo-backup.yaml" "600 400"
    grep -qE '^password: .+' "$SECRETS_DIR/mongo-backup.yaml" || die "$SECRETS_DIR/mongo-backup.yaml has no 'password: ' line"
    check_private "$SECRETS_DIR/mcli" "700"
    check_private "$SECRETS_DIR/mcli/config.json" "600 400"
    check_alert_secrets
}

check_alert_secrets() {
    check_private "$SECRETS_DIR/postmark.header" "600 400"
    grep -qE '^X-Postmark-Server-Token: .+' "$SECRETS_DIR/postmark.header" ||
        die "$SECRETS_DIR/postmark.header must be one line: X-Postmark-Server-Token: <token>"
    check_private "$SECRETS_DIR/ping.url" "600 400"
    grep -qE '^https://' "$SECRETS_DIR/ping.url" || die "$SECRETS_DIR/ping.url must hold the healthchecks.io ping URL"
}

check_tools() {
    local t
    for t in restic mongodump mcli jq curl flock; do
        command -v "$t" >/dev/null || die "$t is not installed"
    done
}

restic_env() {
    set -a
    # shellcheck source=/dev/null
    . "$SECRETS_DIR/s3.env"
    set +a
    export RESTIC_REPOSITORY RESTIC_CACHE_DIR
    export RESTIC_PASSWORD_FILE="$SECRETS_DIR/restic.pass"
}

# ---------------------------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------------------------

ping_hc() { # "" | /start | /fail
    if [ "$MODE" = dry-run ]; then return 0; fi
    local url
    url="$(head -n1 "$SECRETS_DIR/ping.url")"
    curl -fsS -m 10 --retry 3 -o /dev/null "${url}$1" || log "warning: healthchecks.io ping '${1:-success}' failed"
}

send_mail() { # subject, body
    local body_file
    body_file="$(mktemp)"
    jq -n --arg from "$ALERT_FROM" --arg to "$ALERT_TO" --arg subject "$1" --arg text "$2" \
        '{From: $from, To: $to, Subject: $subject, TextBody: $text, MessageStream: "outbound"}' >"$body_file"
    # The token is read from the header file by curl itself, so it never appears in a process list.
    if curl -fsS -m 20 --retry 2 -o /dev/null -X POST "$POSTMARK_URL" \
        -H "Accept: application/json" -H "Content-Type: application/json" \
        -H @"$SECRETS_DIR/postmark.header" --data-binary @"$body_file"; then
        log "alert email sent to $ALERT_TO: $1"
    else
        log "ERROR: could not send the alert email ($1)"
        rm -f "$body_file"
        return 1
    fi
    rm -f "$body_file"
}

notify_failure() {
    check_alert_secrets
    local tail_lines
    tail_lines="$(tail -n 40 "$LOG_FILE" 2>/dev/null || echo "(no log file)")"
    send_mail "[Peerify backup] FAILED on $BOX ($(hostname))" \
        "The Peerify backup on $BOX ($(hostname)) failed at $(date -u +%Y-%m-%dT%H:%MZ).

Last log lines:
$tail_lines

More: sudo journalctl -u peerify-backup -n 200
Log file: $LOG_FILE
What to do: RESTORE-RUNBOOK.md, section 0 'When an alert arrives'."
}

# ---------------------------------------------------------------------------------------------
# restic
# ---------------------------------------------------------------------------------------------

# restic backup of the given paths as one snapshot of one part. Logs only the summary line.
restic_backup() {
    local part="$1"; shift
    local args=(backup --json --host "peerify-$BOX" --tag "$part" --tag "box-$BOX")
    if [ -n "$EXTRA_TAG" ]; then args+=(--tag "$EXTRA_TAG"); fi
    if [ "$MODE" = dry-run ]; then args+=(--dry-run); fi
    local out err rc=0
    out="$(mktemp)"; err="$(mktemp)"
    restic "${args[@]}" "$@" >"$out" 2>"$err" || rc=$?
    local summary
    summary="$(jq -r 'select(.message_type == "summary")
        | "files=\(.total_files_processed) new=\(.files_new) changed=\(.files_changed) added=\(.data_added)B snapshot=\((.snapshot_id // "dry-run")[0:8])"' \
        <"$out" 2>/dev/null | tail -n1)"
    if [ "$rc" -eq 0 ]; then
        log "  $part: ${summary:-done}"
    else
        # Exit 3 means some files couldn't be read: the snapshot is incomplete, so count it as failed.
        log "  $part: restic exit $rc ${summary:+($summary)}"
        sed -E 's/^/    restic: /' "$err" | tail -n 5 | while IFS= read -r l; do log "$l"; done
    fi
    rm -f "$out" "$err"
    return "$rc"
}

# ---------------------------------------------------------------------------------------------
# The four parts
# ---------------------------------------------------------------------------------------------

part_mongo() {
    local dir="$STATE_DIR/mongo" db file rc=0
    mkdir -p "$dir"
    for db in $MONGO_DBS; do
        file="$dir/$db.archive"
        if [ "$MODE" = dry-run ]; then
            log "  mongo: would dump database '$db' as user '$MONGO_USER' and back up $file"
            continue
        fi
        rm -f "$file"
        # Not compressed here: restic compresses, and an uncompressed dump deduplicates night to night.
        # The password comes from the --config file, never the command line.
        if ! mongodump --quiet --host "$MONGO_HOST" --port "$MONGO_PORT" \
            --username "$MONGO_USER" --authenticationDatabase "${MONGO_AUTH_DB:-$db}" \
            --config "$SECRETS_DIR/mongo-backup.yaml" --db "$db" --archive="$file" 2>"$dir/.err"; then
            log "  mongo: mongodump of '$db' failed:"
            tail -n 5 "$dir/.err" | while IFS= read -r l; do log "    mongodump: $l"; done
            rc=1
        elif [ ! -s "$file" ]; then
            log "  mongo: mongodump of '$db' produced an empty file"
            rc=1
        else
            log "  mongo: dumped '$db' ($(stat -c %s "$file") bytes)"
            restic_backup mongo "$file" || rc=1
        fi
        rm -f "$file" "$dir/.err"
    done
    return "$rc"
}

part_data() {
    [ -d "$DATA_DIR" ] || { log "  data: $DATA_DIR does not exist"; return 1; }
    log "  data: $DATA_DIR has $(find "$DATA_DIR" -mindepth 2 -maxdepth 2 -path '*/users/*' -type d | wc -l) account key directories"
    restic_backup data "$DATA_DIR"
}

bucket_count() { # alias/bucket -> number of objects (or fails)
    mcli --config-dir "$SECRETS_DIR/mcli" --json ls --recursive "$1" | jq -s '[.[] | select(.status == "success" and .type == "file")] | length'
}

part_buckets() {
    local base="$STATE_DIR/buckets" b target remote local_before mirrored errors rc=0 json
    mkdir -p "$base"
    for b in $BUCKETS; do
        target="$base/$b"
        mkdir -p "$target"
        if ! remote="$(bucket_count "$SILO_ALIAS/$b")"; then
            log "  buckets: cannot list $b"
            rc=1; continue
        fi
        local_before="$(find "$target" -type f | wc -l)"
        # Guard: a bucket that suddenly looks less than half its size is more likely a wrong key or
        # alias than real deletions. Don't let --remove empty the mirror on that; fail loudly instead.
        if [ "$local_before" -ge "$BUCKET_SHRINK_GUARD_MIN" ] && [ $((remote * 2)) -lt "$local_before" ]; then
            log "  buckets: $b has $remote objects but the mirror has $local_before; refusing to mirror (check the silo key and alias)"
            rc=1; continue
        fi
        if [ "$MODE" = dry-run ]; then
            log "  buckets: $b has $remote objects; the local mirror has $local_before files"
            continue
        fi
        json="$(mktemp)"
        if mcli --config-dir "$SECRETS_DIR/mcli" --quiet --json mirror --overwrite --remove "$SILO_ALIAS/$b" "$target" >"$json" 2>&1; then
            mirrored="$(jq -s '[.[] | select(.status == "success")] | length' <"$json" 2>/dev/null || echo "?")"
            log "  buckets: $b mirrored ($remote objects, $mirrored changes)"
        else
            errors="$(jq -s '[.[] | select(.status == "error")] | length' <"$json" 2>/dev/null || echo "?")"
            log "  buckets: mirroring $b failed ($errors errors)"
            rc=1
        fi
        rm -f "$json"
    done
    restic_backup buckets "$base" || rc=1
    return "$rc"
}

part_config() {
    local meta="$STATE_DIR/meta" paths=() p rc=0
    mkdir -p "$meta"
    for p in "${CONFIG_PATHS_REQUIRED[@]}"; do
        if [ -e "$p" ]; then paths+=("$p"); else log "  config: required path missing: $p"; rc=1; fi
    done
    for p in "${CONFIG_PATHS_OPTIONAL[@]}"; do
        if [ -e "$p" ]; then paths+=("$p"); else log "  config: optional path missing (skipped): $p"; fi
    done
    if [ "$MODE" = dry-run ]; then
        log "  config: would back up ${paths[*]} and the deployed version"
        restic_backup config "${paths[@]}" || rc=1
        return "$rc"
    fi
    if curl -fsS -m 10 "http://127.0.0.1:$APP_PORT/api/version" >"$meta/deployed-version.json" 2>/dev/null; then
        log "  config: deployed version $(jq -r '.gitSha // "?"' "$meta/deployed-version.json" 2>/dev/null | cut -c1-8)"
    else
        log "  config: warning: could not read /api/version on port $APP_PORT"
        echo '{"gitSha": null}' >"$meta/deployed-version.json"
    fi
    {
        echo "box=$BOX host=$(hostname) at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        restic version 2>/dev/null | head -n1
        mongodump --version 2>/dev/null | head -n1
        mcli --version 2>/dev/null | head -n1
    } >"$meta/backup-info.txt"
    restic_backup config "${paths[@]}" "$meta" || rc=1
    return "$rc"
}

# ---------------------------------------------------------------------------------------------
# Retention and check
# ---------------------------------------------------------------------------------------------

# By calendar date, not restic's --keep-within (which counts from the newest snapshot, so a week
# of failed runs would keep old snapshots past 30 days). Every snapshot of this box taken before
# now - KEEP_DAYS days is forgotten, then pruned with --max-unused 0, so no partly used pack keeps
# data from it. If backups have failed for longer than KEEP_DAYS, that leaves no snapshots: the
# 30-day promise wins, and the missing-run alert will long have said so.
part_retention() {
    local cutoff ids=() id t ts list
    cutoff=$(($(date +%s) - KEEP_DAYS * 86400))
    list="$(restic snapshots --json --host "peerify-$BOX" | jq -r '.[] | "\(.id) \(.time)"')" || {
        log "  retention: could not list snapshots"; return 1; }
    while read -r id t; do
        [ -n "$id" ] || continue
        ts="$(date -d "$t" +%s 2>/dev/null)" || { log "  retention: unreadable time on snapshot ${id:0:8}"; return 1; }
        if [ "$ts" -lt "$cutoff" ]; then ids+=("$id"); fi
    done <<<"$list"
    log "  retention: $(printf '%s\n' "$list" | grep -c . || true) snapshots, ${#ids[@]} older than $KEEP_DAYS days"
    if [ "$MODE" = dry-run ]; then
        if [ "${#ids[@]}" -gt 0 ]; then log "  retention: would forget ${#ids[@]} snapshots and prune"; fi
        return 0
    fi
    if [ "${#ids[@]}" -gt 0 ]; then
        restic forget --quiet "${ids[@]}" >/dev/null || { log "  retention: forget failed"; return 1; }
        log "  retention: forgot ${#ids[@]} snapshots"
    fi
    restic prune --quiet --max-unused 0 >/dev/null || { log "  retention: prune failed"; return 1; }
    log "  retention: pruned"
}

part_check() {
    if [ "$MODE" = dry-run ]; then
        log "  check: skipped in a dry run"
        return 0
    fi
    local args=(check --quiet) what="structure" err rc=0
    if [ "$(date +%u)" = "$DEEP_CHECK_WEEKDAY" ]; then
        args+=(--read-data-subset="$DEEP_CHECK_SUBSET")
        what="structure, and read and verified $DEEP_CHECK_SUBSET of the data"
    fi
    err="$(mktemp)"
    restic "${args[@]}" >/dev/null 2>"$err" || rc=$?
    if [ "$rc" -eq 0 ]; then
        log "  check: ok ($what)"
    else
        log "  check: FAILED, restic exit $rc ($what)"
        tail -n 5 "$err" | while IFS= read -r l; do log "    restic: $l"; done
    fi
    rm -f "$err"
    return "$rc"
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------

FAILED=()
run_part() {
    local name="$1"
    log "$name ..."
    if ! "part_$name"; then
        FAILED+=("$name")
    fi
}

load_config

case "$MODE" in
    notify-failure)
        notify_failure
        exit $? ;;
    check-config)
        check_secrets; check_tools
        log "config ok: $CONFIG_FILE (box $BOX, databases: $MONGO_DBS, buckets: $BUCKETS, keep $KEEP_DAYS days)"
        exit 0 ;;
    test-alert)
        check_alert_secrets
        send_mail "[Peerify backup] test alert from $BOX" \
            "This is a test of the backup alert email from $BOX ($(hostname)). Nothing is wrong.
healthchecks.io was also sent a /fail ping, so it will email you too; the next successful
backup turns it green again."
        ping_hc /fail
        exit 0 ;;
esac

check_secrets
check_tools
restic_env

case "$MODE" in
    snapshots) exec restic snapshots --host "peerify-$BOX" ;;
    restic) exec restic "${RESTIC_ARGS[@]}" ;;
esac

exec 9>"$LOCK_FILE"
flock -n 9 || die "another peerify-backup run is in progress"

START=$(date +%s)
log "=== peerify-backup $MODE started${EXTRA_TAG:+ (tag $EXTRA_TAG)} ==="
ping_hc /start

if ! restic cat config >/dev/null 2>&1; then
    log "ERROR: cannot open the restic repository (not initialised, wrong password, wrong S3 key, or no network)"
    ping_hc /fail
    exit 1
fi
[ "$MODE" = dry-run ] || restic unlock >/dev/null 2>&1 || true # removes stale locks only

run_part mongo
run_part data
run_part buckets
run_part config
run_part retention
run_part check

ELAPSED=$(($(date +%s) - START))
if [ "${#FAILED[@]}" -gt 0 ]; then
    log "=== FAILED after ${ELAPSED}s: ${FAILED[*]} ==="
    ping_hc /fail
    exit 1
fi
log "=== ok after ${ELAPSED}s ==="
ping_hc ""
exit 0
