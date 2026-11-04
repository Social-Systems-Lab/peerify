# Installing peerify-backup

These are rollout steps 3–7 (staging) and step 10 (prod, the same steps again). The restore side is in `RESTORE-RUNBOOK.md`.

**How to use this:**
- Each block says which **box** and which **user** it's for.
  - **User: tim** means you're logged in over SSH as `tim`.
  - Lines starting with `sudo` run that one command as root.
- Paste **one block at a time** and send me the output.
- At each **STOP**, wait until you've typed your approval.
- Where a block differs between staging and prod, both versions are given. Use the one for the box you're on.
- Every block starts with `hostname`, so the output shows which box it ran on.

## Before you start (step 1, in browsers, already planned)

- **Cleura, region Kna1:** two projects, `peerify-backup-staging` and `peerify-backup-prod`.
  - Each has one private bucket with the same name as its project: versioning off, no object lock.
  - Each has its own S3 credentials (access key and secret key).
- **Password manager:** one entry per box, "Peerify backup – staging" and "Peerify backup – prod". Each holds:
  - the S3 access key and secret key,
  - the repository URL: `s3:https://s3-kna1.citycloud.com/peerify-backup-staging` (or `-prod`),
  - the Cleura project name.
  - The restic password is added in step 5.
- **Postmark:** a separate server (e.g. "Peerify ops") with its own server token, plus a verified sender address.
- **healthchecks.io:** two checks, "peerify-backup staging" and "peerify-backup prod", each with **Period 1 day, Grace 2 hours**. Copy each one's ping URL.
- **The code is on the box:** this branch is merged into `staging` and you've deployed staging as usual. The files are then in `/srv/peerify/app/circles/scripts/backup/`. For prod, the same after the release to `main`.

---

## Step 3: install restic

**Box: staging** (prod at step 10) · **User: tim**

```
hostname
sudo apt-get update
sudo apt-get install -y restic
restic version
```

You should see `restic 0.16.4` (or newer).

**STOP.**

---

## Step 4a: the MongoDB backup user

This creates the folder for the backup's secrets and a random password for the Mongo user `peerify_backup`, stored in a root-only file. Nobody needs to see or type it.

**Box: staging or prod** · **User: tim**

```
hostname
sudo install -d -m 700 -o root -g root /etc/peerify-backup
sudo bash -c 'umask 077; test -e /etc/peerify-backup/mongo-backup.yaml || printf "password: %s\n" "$(openssl rand -hex 24)" > /etc/peerify-backup/mongo-backup.yaml'
sudo ls -l /etc/peerify-backup/mongo-backup.yaml
```

You should see `-rw------- 1 root root`.

Next, create the user. It has Mongo's built-in **`backup`** role: it can read everything, including the user list in `admin`, but can't write anything. The block asks for the **`tim_admin` password**.

**Box: staging or prod** (the same on both) · **User: tim**

```
hostname
sudo mongosh --quiet "mongodb://tim_admin@127.0.0.1:27017/admin" --eval '
const pw = require("fs").readFileSync("/etc/peerify-backup/mongo-backup.yaml", "utf8").match(/^password: (\S+)$/m)[1];
db.getSiblingDB("admin").createUser({ user: "peerify_backup", pwd: pw, roles: [{ role: "backup", db: "admin" }] });
printjson(db.getSiblingDB("admin").getUser("peerify_backup").roles);'
```

You should see `[ { role: 'backup', db: 'admin' } ]`.

**STOP.**

---

## Step 4b: a read-only key for the buckets (silo)

This uses your existing `local-admin` alias.

First, the policy: read and list only, on this box's two buckets.

**Box: staging** · **User: tim**

```
hostname
cat > ~/peerify-backup-ro.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
  "Resource": ["arn:aws:s3:::circles-staging", "arn:aws:s3:::circles-staging/*",
               "arn:aws:s3:::peerify-media-staging", "arn:aws:s3:::peerify-media-staging/*"] } ] }
EOF
mcli admin policy create local-admin peerify-backup-ro ~/peerify-backup-ro.json
```

**Box: prod** · **User: tim**

```
hostname
cat > ~/peerify-backup-ro.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
  "Resource": ["arn:aws:s3:::circles", "arn:aws:s3:::circles/*",
               "arn:aws:s3:::peerify-media", "arn:aws:s3:::peerify-media/*"] } ] }
EOF
mcli admin policy create local-admin peerify-backup-ro ~/peerify-backup-ro.json
```

Next, the user `peerify-backup` with a random secret. Only root's own `mcli` settings keep the secret; it's never shown. (For an instant the secret is visible to other users' process listings on this box. Nobody but you logs in here.)

**Box: staging or prod** · **User: tim**

```
hostname
S=$(openssl rand -hex 24)
mcli admin user add local-admin peerify-backup "$S"
mcli admin policy attach local-admin peerify-backup-ro --user peerify-backup
sudo install -d -m 700 -o root -g root /etc/peerify-backup/mcli
sudo mcli --config-dir /etc/peerify-backup/mcli alias set backupro http://127.0.0.1:9000 peerify-backup "$S" >/dev/null && echo "alias backupro saved"
unset S
```

Check that it can read. These are object counts only.

**Box: staging** · **User: tim**

```
sudo mcli --config-dir /etc/peerify-backup/mcli ls --recursive backupro/circles-staging | wc -l
sudo mcli --config-dir /etc/peerify-backup/mcli ls --recursive backupro/peerify-media-staging | wc -l
```

**Box: prod** · **User: tim**

```
sudo mcli --config-dir /etc/peerify-backup/mcli ls --recursive backupro/circles | wc -l
sudo mcli --config-dir /etc/peerify-backup/mcli ls --recursive backupro/peerify-media | wc -l
```

The numbers should match the survey: staging 207 and 17, prod 266 and 103, give or take new uploads.

**STOP.**

---

## Step 5: files, config, secrets, and the repository

### 5a. Install the files

**Box: staging** · **User: tim**

```
hostname
SRC=/srv/peerify/app/circles/scripts/backup
sudo test -f $SRC/peerify-backup.sh && echo "code found"
sudo install -m 755 -o root -g root $SRC/peerify-backup.sh /usr/local/sbin/peerify-backup
sudo install -m 600 -o root -g root $SRC/backup.conf.staging /etc/peerify-backup/backup.conf
sudo install -m 644 -o root -g root $SRC/systemd/peerify-backup.service $SRC/systemd/peerify-backup.timer $SRC/systemd/peerify-backup-failure.service /etc/systemd/system/
sudo install -d -m 755 /etc/systemd/system/peerify-backup.timer.d
sudo install -m 644 -o root -g root $SRC/systemd/peerify-backup.timer.d/staging.conf /etc/systemd/system/peerify-backup.timer.d/
sudo install -m 644 -o root -g root $SRC/logrotate/peerify-backup /etc/logrotate.d/peerify-backup
sudo install -d -m 755 /usr/local/share/doc/peerify-backup
sudo install -m 644 -o root -g root $SRC/RESTORE-RUNBOOK.md $SRC/INSTALL.md /usr/local/share/doc/peerify-backup/
sudo systemctl daemon-reload
```

**Box: prod** · **User: tim.** This is the same, but with the prod config and without the staging timer file.

```
hostname
SRC=/srv/peerify/app/circles/scripts/backup
sudo test -f $SRC/peerify-backup.sh && echo "code found"
sudo install -m 755 -o root -g root $SRC/peerify-backup.sh /usr/local/sbin/peerify-backup
sudo install -m 600 -o root -g root $SRC/backup.conf.prod /etc/peerify-backup/backup.conf
sudo install -m 644 -o root -g root $SRC/systemd/peerify-backup.service $SRC/systemd/peerify-backup.timer $SRC/systemd/peerify-backup-failure.service /etc/systemd/system/
sudo install -m 644 -o root -g root $SRC/logrotate/peerify-backup /etc/logrotate.d/peerify-backup
sudo install -d -m 755 /usr/local/share/doc/peerify-backup
sudo install -m 644 -o root -g root $SRC/RESTORE-RUNBOOK.md $SRC/INSTALL.md /usr/local/share/doc/peerify-backup/
sudo systemctl daemon-reload
```

### 5b. Alert addresses

This block asks two questions; nothing in it needs editing:
1. the address alerts go to,
2. the sender address: one that Postmark has verified.

**Box: staging or prod** · **User: tim**

```
sudo bash -c 'read -r -p "Email address for backup alerts: " TO
read -r -p "Sender address (verified in Postmark): " FROM
for a in "$TO" "$FROM"; do
  if ! [[ "$a" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+$ ]]; then echo "Not an email address: \"$a\". Nothing was changed; paste the block again."; exit 1; fi
done
sed -i "s|^ALERT_TO=.*|ALERT_TO=\"$TO\"|; s|^ALERT_FROM=.*|ALERT_FROM=\"$FROM\"|" /etc/peerify-backup/backup.conf
echo "Saved. Check both lines:"
grep -E "^ALERT_(TO|FROM)=" /etc/peerify-backup/backup.conf'
```

**Check the two printed lines.** If either is wrong, paste the block again.

If this step is skipped, the config still says `CHANGE-ME`. Every later command, from `--check-config` in step 5e on, then refuses to run and points back here.

### 5c. Secrets you type in

This block asks four questions, so have the password-manager entry for this box open:
1. the Cleura S3 access key,
2. the S3 secret key (hidden while you type or paste),
3. the Postmark ops server token (hidden),
4. this box's healthchecks.io ping URL.

**Box: staging or prod** · **User: tim**

```
sudo bash -c 'umask 077
read -r -p "Cleura S3 access key: " A
read -r -s -p "Cleura S3 secret key (hidden): " S; echo
printf "AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n" "$A" "$S" > /etc/peerify-backup/s3.env
read -r -s -p "Postmark ops server token (hidden): " T; echo
printf "X-Postmark-Server-Token: %s\n" "$T" > /etc/peerify-backup/postmark.header
read -r -p "healthchecks.io ping URL for this box: " U
printf "%s\n" "$U" > /etc/peerify-backup/ping.url
echo saved'
```

### 5d. The restic password: save it before anything uses it

This makes a random password and shows it **once**, in groups of 4 characters so it's easy to copy onto paper.

**Box: staging or prod** · **User: tim**

```
hostname
sudo bash -c 'umask 077; if test -e /etc/peerify-backup/restic.pass; then echo "restic.pass already exists; not replacing it"; else openssl rand -hex 24 > /etc/peerify-backup/restic.pass; fi'
sudo sed 's/..../& /g' /etc/peerify-backup/restic.pass
```

**Now, before anything else:**
1. Put the password (without the spaces) in this box's password-manager entry, as "restic password".
2. Write the whole entry on paper: the restic password, the S3 access key and secret, and the repository URL. Seal it, and keep it away from where you work.
3. Run `clear` so it's off the screen.

Without this password the backups can never be read, by anyone, and there is no reset.

**STOP: type "saved" when the password is in the password manager and on paper.**

### 5e. Check, then create the repository

**Box: staging or prod** · **User: tim**

```
hostname
sudo peerify-backup --check-config
sudo peerify-backup --restic init
```

You should see `config ok` and `created restic repository ... at s3:https://s3-kna1.citycloud.com/...`. If `init` reports an error about a region or a signature, send me the output.

**STOP.**

---

## Step 6: the first run, by hand

First a dry run. It writes, sends and deletes nothing.

**Box: staging or prod** · **User: tim**

```
hostname
sudo peerify-backup --dry-run
```

**STOP.** Send me the output.

Then the real first run, and the list of snapshots:

```
hostname
sudo peerify-backup --tag first-run
sudo peerify-backup --snapshots
```

You should see 5 snapshots, tagged `mongo` (twice: the app database and `admin`), `data`, `buckets` and `config`, each also tagged `first-run`. healthchecks.io should show the check as up.

**STOP.**

---

## Step 7: switch on the timer, and test the alerts

**Box: staging or prod** · **User: tim**

```
hostname
sudo systemctl enable --now peerify-backup.timer
systemctl list-timers peerify-backup.timer --no-pager
```

"NEXT" should be 03:30 on staging and 02:30 on prod (Stockholm time).

Run it once through systemd, exactly as at night:

```
sudo systemctl start peerify-backup.service
systemctl status peerify-backup.service --no-pager | head -n 5
sudo tail -n 25 /var/log/peerify-backup/backup.log
```

The status should end with `status=0/SUCCESS`, and the log with `=== ok after ...`.

**Test both alert channels.** You should get two emails: one from Postmark ("test alert"), and one from healthchecks.io saying the check is down.

```
sudo peerify-backup --test-alert
```

**Test the failure email the way systemd sends it.** You get "FAILED on staging" (or prod) with the last log lines. Nothing has really failed.

```
sudo systemctl start peerify-backup-failure.service
```

**Turn healthchecks.io green again** with a real run:

```
sudo systemctl start peerify-backup.service
```

**Test the missing-run alert** (staging only, optional). Stop the timer for one night:

```
sudo systemctl stop peerify-backup.timer
```

The next day, about 26 hours after the last run, healthchecks.io emails you. Then start it again:

```
sudo systemctl start peerify-backup.timer
systemctl list-timers peerify-backup.timer --no-pager
```

**Then watch 3 nights.** Each morning:

```
sudo grep -E '===' /var/log/peerify-backup/backup.log | tail -n 3
```

**STOP.**

---

## Before each release (replaces the manual mongodump and tar)

**Box: prod** (or staging) · **User: tim**

```
sudo peerify-backup --tag pre-release
sudo peerify-backup --restic snapshots --tag pre-release --compact
```

Put the snapshot IDs in the release notes. These snapshots are deleted after 29 days like all the others.

---

## Switching it off (if ever needed)

**Box: staging or prod** · **User: tim**

```
sudo systemctl disable --now peerify-backup.timer
```

This leaves the backups already made in Cleura untouched. They age out only while the timer runs, because retention happens in the nightly run. So if it stays off for long, delete old snapshots by hand, or delete the bucket in the Cleura dashboard, to keep the 30-day promise.
