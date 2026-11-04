# Restore runbook: Peerify backups

This is for getting data back from the nightly backups made by `peerify-backup` (see `INSTALL.md`).

**How to use this:**
- Each block says which **box** and which **user** it's for.
  - **User: tim** means you're logged in over SSH as `tim`; lines with `sudo` run as root.
  - **User: root shell** means first run `sudo -i`, then paste inside that shell.
- Paste **one block at a time**, check the output against "you should see", then go on.
- **If anything looks different, stop** and send me the output.

**Names per box** (the commands below use staging's names; for prod, swap them as in this table):

| | staging | prod |
|---|---|---|
| box | `peerify-staging` | `peerify-prod` |
| PM2 process | `peerify-staging` | `peerify` |
| app port | 3001 | 3000 |
| Mongo database | `peerify_staging` | `circles` |
| public bucket | `circles-staging` | `circles` |
| private bucket | `peerify-media-staging` | `peerify-media` |
| restic host | `peerify-staging` | `peerify-prod` |
| repository | `s3:https://s3-kna1.citycloud.com/peerify-backup-staging` | `s3:https://s3-kna1.citycloud.com/peerify-backup-prod` |
| password-manager entry | "Peerify backup – staging" | "Peerify backup – prod" |

**What's in each night's backup:**

| Tag | What it is | Paths inside the snapshot |
|---|---|---|
| `mongo` | the app database, and `admin` (all Mongo users) | `/var/backups/peerify/mongo/<db>.archive` |
| `data` | account key files and the server key | `/srv/peerify/data/...` |
| `buckets` | every file from both buckets | `/var/backups/peerify/buckets/<bucket>/...` |
| `config` | app.env, nginx, TLS, silo and Mongo config, PM2 dump, deployed version | the real paths, plus `/var/backups/peerify/meta/` |

**Snapshot age:** snapshots are kept 29 days. The newest one is called `latest`.

---

## 0. When an alert arrives

**Email "[Peerify backup] FAILED on ...":** a nightly run failed. The email's log lines name the part that failed (`mongo`, `data`, `buckets`, `config`, `retention` or `check`).

**Box: the one named in the email** · **User: tim**

```
hostname
sudo journalctl -u peerify-backup -n 100 --no-pager
```

Then try once more:

```
sudo systemctl start peerify-backup.service
sudo grep -E '===' /var/log/peerify-backup/backup.log | tail -n 2
```

If the last line says `=== ok`, it was temporary, for example the network. If it says `FAILED` again, send me both outputs.

**Email from healthchecks.io saying "down", but no FAILED email:** the run didn't happen at all. Either the box is down, or the timer is off.

**Box: the one named** · **User: tim**

```
hostname
systemctl list-timers peerify-backup.timer --no-pager
systemctl status peerify-backup.service --no-pager | head -n 8
```

If you can't log in to the box at all, the box itself is the problem; see section 4.

---

## 1. See what backups exist

**Box: staging or prod** · **User: tim**

```
hostname
sudo peerify-backup --snapshots
```

Each line is one snapshot: an ID (8 characters), a date and time, the tags, and the paths. To restore from a certain night, note the **ID** of the snapshot with the right tag and date.

---

## 2. One person can't log in ("Account credentials missing")

Their key files are missing from `/srv/peerify/data/users/<their DID>`.

**First, the simplest fix:** they use "Forgot password". A reset rebuilds the key files and keeps their account and DID. Only restore from the backup if that isn't possible.

**Find their DID** from their handle. **Before pasting**, change `HANDLE`. It asks for the `tim_admin` password.

**Box: staging** · **User: tim** (on prod, change `peerify_staging` to `circles`)

```
mongosh --quiet "mongodb://tim_admin@127.0.0.1:27017/admin" --eval 'printjson(db.getSiblingDB("peerify_staging").circles.findOne({ handle: "HANDLE" }, { _id: 0, did: 1, handle: 1 }))'
```

**Restore their folder** from the newest backup. **Before pasting**, change `THE-DID` to the DID from above.

**Box: staging** · **User: tim** (on prod, use `--host peerify-prod`)

```
hostname
DID=THE-DID
sudo install -d -m 700 /var/backups/peerify/restore
sudo peerify-backup --restic restore latest --host peerify-staging --tag data --target /var/backups/peerify/restore --include "/srv/peerify/data/users/$DID"
sudo ls -la "/var/backups/peerify/restore/srv/peerify/data/users/$DID"
```

You should see `salt.bin`, `iv.bin`, `publicKey.pem` and `privateKey.pem.enc`.

Put it in place:

```
sudo cp -a "/var/backups/peerify/restore/srv/peerify/data/users/$DID" /srv/peerify/data/users/
sudo chown -R peerify:peerify "/srv/peerify/data/users/$DID"
sudo rm -rf /var/backups/peerify/restore
```

The person logs in with the password they had **at the time of that backup**.

---

## 3. Files from the buckets

**A file deleted today or yesterday:** the box keeps a plain copy of each bucket as of last night, in `/var/backups/peerify/buckets/<bucket>/`. You can copy it from there with the commands below, skipping the `restic restore` line and using that folder instead.

**A file from an earlier night, or a whole bucket:**

**Box: staging** · **User: tim** (prod: `--host peerify-prod`, and its bucket names)

```
hostname
sudo install -d -m 700 /var/backups/peerify/restore
sudo peerify-backup --restic restore latest --host peerify-staging --tag buckets --target /var/backups/peerify/restore --include /var/backups/peerify/buckets/circles-staging
sudo cp -a /var/backups/peerify/restore/var/backups/peerify/buckets/circles-staging ~/restore-circles-staging
sudo chown -R tim:tim ~/restore-circles-staging
find ~/restore-circles-staging -type f | wc -l
```

Copy back into silo **only what's missing**. Without `--overwrite`, nothing already there is replaced, and without `--remove`, nothing is deleted.

```
mcli mirror ~/restore-circles-staging local-admin/circles-staging
rm -rf ~/restore-circles-staging
sudo rm -rf /var/backups/peerify/restore
```

For the private bucket, do the same with `peerify-media-staging`.

**Known limit:** silo guesses each file's type (`Content-Type`) from its name ending, such as `.jpg` or `.mp3`. Almost all Peerify file names have one. A file without one comes back as a generic type: images still show, but a browser may download such a file instead of playing it.

---

## 4. The database (the box still works)

Use this when the data in Mongo is wrong or damaged, but the box itself is fine.

**What it costs:** everything written to the database since the snapshot is lost. This means new accounts, posts and messages. Pick the newest snapshot from before the problem started.

### 4.1 Pick the snapshot

**Box: staging** · **User: tim**

```
hostname
sudo peerify-backup --restic snapshots --host peerify-staging --tag mongo
```

Each night has two `mongo` snapshots: one with `peerify_staging.archive` and one with `admin.archive`. Note the **ID** of the `peerify_staging.archive` snapshot from the night you want.

### 4.2 Stop the app, and keep a copy of the current state

Keeping a copy means you can go back if the restore turns out to be the wrong choice.

**Box: staging** · **User: tim** (prod: `pm2 stop peerify`)

```
hostname
sudo -iu peerify pm2 stop peerify-staging
sudo peerify-backup --tag before-restore
```

### 4.3 Restore

**Before pasting**, change `SNAPSHOT-ID` to the ID from 4.1. `mongorestore` asks for the `tim_admin` password.

**Box: staging** · **User: tim** (prod: `circles` instead of `peerify_staging`)

```
hostname
ID=SNAPSHOT-ID
sudo install -d -m 700 /var/backups/peerify/restore
sudo bash -c "peerify-backup --restic dump $ID /var/backups/peerify/mongo/peerify_staging.archive > /var/backups/peerify/restore/db.archive"
sudo ls -l /var/backups/peerify/restore/db.archive
sudo mongorestore --host 127.0.0.1 --username tim_admin --authenticationDatabase admin --archive=/var/backups/peerify/restore/db.archive --nsInclude 'peerify_staging.*' --drop
```

You should see `... document(s) restored successfully. 0 document(s) failed to restore.`

`--drop` replaces each collection that's in the backup. A collection created after the snapshot stays as it is; that's rare.

### 4.4 Re-apply erasures, start the app, check

1. **Re-apply erasures:** accounts deleted after the snapshot are back. Follow section 7 **before** starting the app.
2. **Start the app and check it:**

**Box: staging** · **User: tim** (prod: `peerify`, port 3000)

```
sudo -iu peerify pm2 start peerify-staging
sleep 5
curl -fsS http://127.0.0.1:3001/api/health; echo
curl -fsS http://127.0.0.1:3001/api/version; echo
sudo rm -rf /var/backups/peerify/restore
```

3. **Check in the browser:** log in, and see that a picture, a track and an admin page load.
4. **Write it down** in SESSION_LOG: which snapshot, when, and why.

---

## 5. Full restore on a new box (box lost) — and the staging rehearsal

This rebuilds a whole box from the backups and the password-manager entry alone. Nothing comes from the old box.

**For the rehearsal**, do it on a **temporary VM** in the staging Cleura project, and follow the checks in 5.9. Delete the VM the same day.

**Before you start, you need:**
- **A new VM:** Ubuntu 24.04, in Stockholm, with your SSH key for `tim`.
- **The base software,** installed the way the Cleura boxes were built (your build notes): `mongodb-org` 8.0 (**auth not enabled yet**: leave the default `/etc/mongod.conf` for now), the `silo` package, nginx, certbot, Node, bun, PM2, ffmpeg, and the `peerify` user.
- **For the rehearsal:** the deploy script only runs on host names it knows. Before step 8 of the rollout, I'll add the rehearsal VM's host name, `peerify-staging-restore`, to `deploy-staging.sh` as a small separate commit. Give the VM that host name.
- **The password-manager entry** for the box you're restoring.

### 5.1 Install restic and open the backups

**Box: the new VM** · **User: tim**

```
hostname
sudo apt-get update && sudo apt-get install -y restic
restic version
```

Then open a root shell; everything up to 5.8 happens inside it.

```
sudo -i
```

**Box: the new VM** · **User: root shell.** It asks for three things from the password manager; the secrets stay hidden while you paste.

```
export RESTIC_REPOSITORY="s3:https://s3-kna1.citycloud.com/peerify-backup-staging"
read -r -p "S3 access key: " AWS_ACCESS_KEY_ID; export AWS_ACCESS_KEY_ID
read -r -s -p "S3 secret key (hidden): " AWS_SECRET_ACCESS_KEY; echo; export AWS_SECRET_ACCESS_KEY
read -r -s -p "restic password (hidden): " RESTIC_PASSWORD; echo; export RESTIC_PASSWORD
restic snapshots --host peerify-staging --compact | tail -n 12
```

You should see the last few nights' snapshots. If it says "wrong password", check the password-manager entry; keep the letters and digits, drop the spaces.

### 5.2 Restore everything into one folder

**Box: the new VM** · **User: root shell**

```
umask 077; mkdir -p /root/restore
for tag in config data buckets; do restic restore latest --host peerify-staging --tag $tag --target /root/restore || echo "FAILED: $tag"; done
for db in peerify_staging admin; do restic dump latest --host peerify-staging --tag mongo --path /var/backups/peerify/mongo/$db.archive /var/backups/peerify/mongo/$db.archive > /root/restore/$db.archive || echo "FAILED: $db"; done
ls -la /root/restore /root/restore/srv/peerify/data
cat /root/restore/var/backups/peerify/meta/deployed-version.json; echo
```

You should see no "FAILED" lines, the folders, and the `gitSha` that was live at the time. Note it down.

### 5.3 Settings back in place

**Box: the new VM** · **User: root shell**

```
install -d -m 700 -o peerify -g peerify /srv/peerify /srv/peerify/env /srv/peerify/data
install -m 600 -o peerify -g peerify /root/restore/srv/peerify/env/app.env /srv/peerify/env/app.env
install -m 600 -o root -g root /root/restore/etc/default/minio /etc/default/minio
mkdir -p /etc/systemd/system/silo.service.d
cp -a /root/restore/etc/systemd/system/silo.service.d/. /etc/systemd/system/silo.service.d/
install -d -m 700 -o silo -g silo /var/lib/silo /var/lib/silo/data
systemctl daemon-reload && systemctl restart silo && systemctl is-active silo
```

You should see `active`.

### 5.4 The database

First the users, then the app's data. Then auth is switched on with the restored config.

**Box: the new VM** · **User: root shell**

```
mongorestore --host 127.0.0.1 --archive=/root/restore/admin.archive --nsInclude 'admin.*'
mongorestore --host 127.0.0.1 --archive=/root/restore/peerify_staging.archive --nsInclude 'peerify_staging.*'
cp /root/restore/etc/mongod.conf /etc/mongod.conf
systemctl restart mongod && sleep 3 && systemctl is-active mongod
```

Both restores should end with `0 document(s) failed to restore`, and the last line should say `active`. From now on Mongo needs logins, and `tim_admin` has its old password.

### 5.5 App data (key files)

**Box: the new VM** · **User: root shell**

```
cp -a /root/restore/srv/peerify/data/. /srv/peerify/data/
chown -R peerify:peerify /srv/peerify/data
ls /srv/peerify/data/users | wc -l
```

The number should match the survey (staging 13, prod 59), plus any accounts made since.

### 5.6 The buckets

This makes an `mcli` alias with silo's restored root login (from `/etc/default/minio`, never shown), recreates the buckets and copies the files in. Then it restores the public bucket's public-read setting, and the app's own silo login (from app.env, never shown) with access to its two buckets.

**Box: the new VM** · **User: root shell**

```
(set -a; . /etc/default/minio; mcli --config-dir /root/.mcli alias set restore http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null) && echo "alias ok"
for b in circles-staging peerify-media-staging; do mcli --config-dir /root/.mcli mb --ignore-existing restore/$b; mcli --config-dir /root/.mcli mirror --quiet /root/restore/var/backups/peerify/buckets/$b restore/$b; mcli --config-dir /root/.mcli ls --recursive restore/$b | wc -l; done
mcli --config-dir /root/.mcli anonymous set download restore/circles-staging
cat > /root/app-rw.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"],
  "Resource": ["arn:aws:s3:::circles-staging", "arn:aws:s3:::circles-staging/*",
               "arn:aws:s3:::peerify-media-staging", "arn:aws:s3:::peerify-media-staging/*"] } ] }
EOF
mcli --config-dir /root/.mcli admin policy create restore peerify-app-rw /root/app-rw.json
(set -a; . /srv/peerify/env/app.env; mcli --config-dir /root/.mcli admin user add restore "$MINIO_ROOT_USERNAME" "$MINIO_ROOT_PASSWORD" >/dev/null && mcli --config-dir /root/.mcli admin policy attach restore peerify-app-rw --user "$MINIO_ROOT_USERNAME") && echo "app login ok"
```

**What to check:**
- The counts should match the survey: staging 207 and 17, prod 266 and 103, plus any uploads since.
- For prod, use prod's bucket names in the `for` line, the `anonymous` line and the policy.
- If "app login" fails because the name is silo's own root user, that's fine: the app then logs in as root, and needs no user of its own.

### 5.7 Re-apply erasures

Follow section 7 **before** the app is opened to anyone.

### 5.8 The app

Leave the root shell, then deploy as usual at the `gitSha` from 5.2.

```
exit
```

The deploy itself:
- **Real box loss:** clone the repo into `/srv/peerify/app/circles` and run the usual deploy script. This needs the host name `peerify-staging` or `peerify-prod`.
- **Rehearsal:** the same, with the rehearsal host name (see "Before you start").

Then the web side:
- **Real box loss:** the files are in `/root/restore/etc/nginx` and `/root/restore/etc/letsencrypt`. Copy them in, or reissue the certificates with certbot. Move the floating IP (or DNS) to the new box.
- **Rehearsal:** don't touch DNS. Reach the app through an SSH tunnel: `ssh -L 3001:127.0.0.1:3001 tim@<the VM's address>`, then open `http://localhost:3001`.

### 5.9 Checks (the rehearsal's pass list)

**Box: the new VM** · **User: tim**

```
hostname
curl -fsS http://127.0.0.1:3001/api/health; echo
curl -fsS http://127.0.0.1:3001/api/version; echo
mongosh --quiet "mongodb://tim_admin@127.0.0.1:27017/admin" --eval 'const d = db.getSiblingDB("peerify_staging"); d.getCollectionNames().sort().forEach(c => print(c, d[c].countDocuments()))' > ~/counts-restored.txt
wc -l ~/counts-restored.txt
```

Run the same `mongosh` line on the real staging box into `~/counts-live.txt`, then compare. Small differences from activity since the snapshot are normal.

**In the browser** (through the tunnel), check:
- a test account can log in;
- a picture shows;
- a track plays;
- a private file opens in the admin view.

**Write down** in SESSION_LOG the time each step took, which steps needed help, and what was missing. Then:
- **Delete the VM and its volume** in the Cleura dashboard, the same day.
- **Clean up on staging:** run `rm ~/counts-live.txt`.

---

## 6. On-box restore check (prod; staging too if you like)

This proves the backups can be read and are complete, without a second box, and without restoring anything into the live database. Everything goes into a temporary folder, which is deleted at the end. A temporary second MongoDB runs on port 27099, only for counting.

**Box: prod** · **User: tim**

```
hostname
sudo peerify-backup --restic check --read-data
```

This takes a while: it downloads everything once. You should see `no errors were found`.

```
T=/var/backups/peerify/restore-test
sudo install -d -m 700 $T $T/db
for tag in data buckets; do sudo peerify-backup --restic restore latest --host peerify-prod --tag $tag --target $T || echo "FAILED: $tag"; done
sudo bash -c "peerify-backup --restic dump latest --host peerify-prod --tag mongo --path /var/backups/peerify/mongo/circles.archive /var/backups/peerify/mongo/circles.archive > $T/circles.archive"
echo "key folders: backup $(sudo ls $T/srv/peerify/data/users | wc -l), live $(sudo ls /srv/peerify/data/users | wc -l)"
for b in circles peerify-media; do echo "$b: backup $(sudo find $T/var/backups/peerify/buckets/$b -type f | wc -l), live $(mcli ls --recursive local-admin/$b | wc -l)"; done
```

The backup and live numbers should be equal, or the live ones a little higher.

**Count the database's documents in a temporary MongoDB.** The last command asks for the `tim_admin` password, for the live counts.

```
T=/var/backups/peerify/restore-test
sudo mongod --dbpath $T/db --port 27099 --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.25 --fork --logpath $T/mongod.log >/dev/null && echo "temporary mongod started"
sudo mongorestore --quiet --port 27099 --archive=$T/circles.archive --nsInclude 'circles.*'
sudo mongosh --quiet --port 27099 --eval 'const d = db.getSiblingDB("circles"); d.getCollectionNames().sort().forEach(c => print(c, d[c].countDocuments()))' > ~/counts-backup.txt
mongosh --quiet "mongodb://tim_admin@127.0.0.1:27017/admin" --eval 'const d = db.getSiblingDB("circles"); d.getCollectionNames().sort().forEach(c => print(c, d[c].countDocuments()))' > ~/counts-live.txt
diff ~/counts-backup.txt ~/counts-live.txt && echo "counts identical"
```

A few small differences are normal: activity since last night.

**Clean up, the same day:**

```
T=/var/backups/peerify/restore-test
sudo mongosh --quiet --port 27099 --eval 'db.getSiblingDB("admin").shutdownServer()' >/dev/null 2>&1; sleep 2
sudo rm -rf $T
rm -f ~/counts-backup.txt ~/counts-live.txt
sudo ls /var/backups/peerify
```

You should see no `restore-test` left.

---

## 7. Re-applying erasures after a restore

**Why it's needed:** a restore brings back every account that was erased after the snapshot was taken. It must be erased again before the app is opened to users.

**Until the erasure log exists** (proposed in the backup-step2 report, not built yet):
- Self-service deletions leave only a line `[ERASURE abcd1234…]` in the PM2 log: the first 8 characters of the DID, and the time.
- On a box that still works:

  **Box: the box restored** · **User: tim**

  ```
  sudo -iu peerify sh -c 'grep -h "\[ERASURE " ~/.pm2/logs/*.log | grep " deleted: "'
  ```

- Send me the output, together with the snapshot date, and I'll match the prefixes against the restored database and give you the exact commands.
- After a box loss, these logs are gone. That gap is what the erasure log closes.
