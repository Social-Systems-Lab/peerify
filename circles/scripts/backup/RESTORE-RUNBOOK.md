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
- **A new VM:** Ubuntu 24.04, in Stockholm (Sto2), with your SSH key.
  - A fresh Cleura Ubuntu VM logs in as **`ubuntu`**, not `tim`. Where a block below says **User: tim** on the new VM, use that login.
  - **For the rehearsal:**
    - name the VM **`peerify-staging-restore`**;
    - give it a security group that allows only SSH (22) from your own IP address;
    - don't touch DNS.
- **The base software** (5.0 below). **Leave MongoDB without login for now:** keep the default `/etc/mongod.conf`. The restored config switches login on in 5.4.
- **For the rehearsal:** the deploy script knows the host name `peerify-staging-restore` since `148d2ef9`. The backed-up version (5.2) must be that commit or newer.
- **The password-manager entry,** or the paper copy, for the box you're restoring.

### 5.0 Base software

These are the versions on the Cleura boxes in November 2026. **Fixed versions:**
- MongoDB 8.0.23;
- bun 1.3.14;
- PM2 7.0.1.

**Same series:**
- Node 22;
- restic 0.16.4, from Ubuntu.

**Box: the new VM** · **User: tim** (or `ubuntu`)

```
hostname
sudo apt-get update
sudo apt-get install -y gnupg curl git jq ffmpeg restic python3 nginx certbot
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org=8.0.23 mongodb-org-database=8.0.23 mongodb-org-server=8.0.23 mongodb-org-mongos=8.0.23 mongodb-org-tools=8.0.23 mongodb-org-shell=8.0.23 mongodb-org-database-tools-extra=8.0.23 mongodb-mongosh
sudo systemctl enable --now mongod
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
curl -fsSL https://bun.sh/install | sudo env BUN_INSTALL=/usr/local bash -s "bun-v1.3.14"
sudo npm install -g pm2@7.0.1
sudo adduser --disabled-password --gecos "" peerify
```

**Silo and `mcli`:**
- Install the same two `.deb` packages as on the boxes:
  - `silo 20260916000000.0.0-1PGSTY`;
  - `mcli 20260916000000.0.0`.
- **Where they come from isn't written down here yet.** Add the download source to this section the next time you have it at hand: a real box loss depends on it.
- Don't start silo yet; its settings come back in 5.3.

**Check:**

```
mongod --version | head -n 1; node -v; bun -v; pm2 -v; restic version; mcli --version | head -n 1; dpkg -l silo | tail -n 1 | awk '{print $2, $3}'
systemctl is-active mongod; id peerify; id silo
```

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

First the users, then the app's data. Then login is switched on with the restored config.

**Box: the new VM** · **User: root shell**

```
mongorestore --host 127.0.0.1 --archive=/root/restore/admin.archive --nsInclude 'admin.*' 2>&1 | tail -n 1
mongorestore --host 127.0.0.1 --archive=/root/restore/peerify_staging.archive --nsInclude 'peerify_staging.*' 2>&1 | tail -n 1
```

**You should see:**
- Both lines end with `0 document(s) failed to restore`.
- The `admin` line also says **`0 document(s) restored successfully`**. That's expected: Mongo users are restored separately and aren't counted as documents.

**Rehearsal only:** count the documents now, while no login is needed, for the comparison in 5.9. If you log in as `tim`, write `/home/tim` instead of `/home/ubuntu`.

```
mongosh --quiet --eval 'const d = db.getSiblingDB("peerify_staging"); d.getCollectionNames().sort().forEach(c => print(c, d[c].countDocuments()))' > /home/ubuntu/counts-restored.txt
wc -l /home/ubuntu/counts-restored.txt
```

**Then switch login on:**

```
cp /root/restore/etc/mongod.conf /etc/mongod.conf
systemctl restart mongod && sleep 3 && systemctl is-active mongod
```

**You should see:** `active`. From now on, Mongo needs logins, and `tim_admin` has its old password.

### 5.5 App data (key files)

**Box: the new VM** · **User: root shell**

```
cp -a /root/restore/srv/peerify/data/. /srv/peerify/data/
chown -R peerify:peerify /srv/peerify/data
ls /srv/peerify/data/users | wc -l
```

**Rehearsal:** the number should match live staging's (`sudo ls /srv/peerify/data/users | wc -l` there), or be a little lower because of accounts made since the snapshot.

**Real box loss:** there's no live box to compare with. Check that it isn't 0.

### 5.6 The buckets

This block does six things:
1. It makes an `mcli` alias with silo's restored root login, taken from `/etc/default/minio` and never shown.
2. It recreates the two buckets and copies the files in.
3. It gives the public bucket back its anonymous download setting. The private bucket stays private.
4. It recreates the app's silo policy under its live name.
5. It recreates the app's own silo user, with the login from app.env (never shown), and attaches the policy.
6. It first checks that app.env names the expected user, and stops if it doesn't.

Use the block for the box you're restoring. Nothing in either block needs editing.

**Box: the new VM, restoring staging** · **User: root shell**

```
(set -a; . /etc/default/minio; mcli --config-dir /root/.mcli alias set restore http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null) && echo "alias ok"
for b in circles-staging peerify-media-staging; do mcli --config-dir /root/.mcli mb --ignore-existing restore/$b; mcli --config-dir /root/.mcli mirror --quiet /root/restore/var/backups/peerify/buckets/$b restore/$b; echo "$b: $(mcli --config-dir /root/.mcli ls --recursive restore/$b | wc -l) objects"; done
mcli --config-dir /root/.mcli anonymous set download restore/circles-staging
mcli --config-dir /root/.mcli anonymous get restore/peerify-media-staging
cat > /root/app-rw.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"],
  "Resource": ["arn:aws:s3:::circles-staging", "arn:aws:s3:::circles-staging/*",
               "arn:aws:s3:::peerify-media-staging", "arn:aws:s3:::peerify-media-staging/*"] } ] }
EOF
mcli --config-dir /root/.mcli admin policy create restore peerify-staging-rw /root/app-rw.json
(set -a; . /srv/peerify/env/app.env
 if [ "$MINIO_ROOT_USERNAME" != "pf-staging-media" ]; then echo "STOP: app.env names silo user '$MINIO_ROOT_USERNAME', expected pf-staging-media. Send me this line."; exit 1; fi
 mcli --config-dir /root/.mcli admin user add restore "$MINIO_ROOT_USERNAME" "$MINIO_ROOT_PASSWORD" >/dev/null && mcli --config-dir /root/.mcli admin policy attach restore peerify-staging-rw --user "$MINIO_ROOT_USERNAME" >/dev/null) && echo "app user pf-staging-media ok"
```

**Box: the new VM, restoring prod** · **User: root shell**

```
(set -a; . /etc/default/minio; mcli --config-dir /root/.mcli alias set restore http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null) && echo "alias ok"
for b in circles peerify-media; do mcli --config-dir /root/.mcli mb --ignore-existing restore/$b; mcli --config-dir /root/.mcli mirror --quiet /root/restore/var/backups/peerify/buckets/$b restore/$b; echo "$b: $(mcli --config-dir /root/.mcli ls --recursive restore/$b | wc -l) objects"; done
mcli --config-dir /root/.mcli anonymous set download restore/circles
mcli --config-dir /root/.mcli anonymous get restore/peerify-media
cat > /root/app-rw.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"],
  "Resource": ["arn:aws:s3:::circles", "arn:aws:s3:::circles/*",
               "arn:aws:s3:::peerify-media", "arn:aws:s3:::peerify-media/*"] } ] }
EOF
mcli --config-dir /root/.mcli admin policy create restore peerify-prod-rw /root/app-rw.json
(set -a; . /srv/peerify/env/app.env
 if [ "$MINIO_ROOT_USERNAME" != "pf-prod-media" ]; then echo "STOP: app.env names silo user '$MINIO_ROOT_USERNAME', expected pf-prod-media. Send me this line."; exit 1; fi
 mcli --config-dir /root/.mcli admin user add restore "$MINIO_ROOT_USERNAME" "$MINIO_ROOT_PASSWORD" >/dev/null && mcli --config-dir /root/.mcli admin policy attach restore peerify-prod-rw --user "$MINIO_ROOT_USERNAME" >/dev/null) && echo "app user pf-prod-media ok"
```

**You should see:**
- `alias ok`.
- **Object counts:**
  - **Rehearsal:** the same as live staging's (`mcli ls --recursive local-admin/<bucket> | wc -l` there), or a little lower.
  - **Real box loss:** not 0.
- The private bucket's access is `private`.
- `app user pf-staging-media ok` (or `pf-prod-media`).

If a `STOP:` line appears instead, send it to me. It contains only the user name, never the password.

### 5.7 Re-apply erasures

Follow section 7 **before** the app is opened to anyone.

### 5.8 The app

**Rehearsal only: email capture must be on before the app starts.** Staging's settings normally have it on: every email goes to `/admin/emails` instead of being sent.

**Box: the new VM** · **User: root shell**

```
grep -cx 'EMAIL_CAPTURE_MODE=on' /srv/peerify/env/app.env
```

**You should see:** `1`. **If you see `0`:**
- If `grep -c '^EMAIL_CAPTURE_MODE=' /srv/peerify/env/app.env` also says `0`, add the line:

  ```
  echo 'EMAIL_CAPTURE_MODE=on' >> /srv/peerify/env/app.env
  ```

- If that says `1` (the line is there with another value), stop and send me the output.

**Never do this on prod.**

Leave the root shell:

```
exit
```

**Deploy the `gitSha` from 5.2.**

**The clone:**
- It goes into **`/srv/peerify/app`**: the app is the repo's `circles/` folder, and the deploy script runs from `/srv/peerify/app/circles`.
- The deploy script accepts only the branch **`staging`** (prod: **`main`**), so the version is checked out under that branch name.

Change `GITSHA` before pasting. On prod, use `-B main` and `./scripts/deploy-peerify.sh`.

**Box: the new VM** · **User: tim**

```
hostname
sudo -iu peerify
```

**Box: the new VM** · **User: peerify** (the shell you just opened)

```
git clone https://github.com/Social-Systems-Lab/peerify.git /srv/peerify/app
cd /srv/peerify/app && git checkout -B staging GITSHA
cd /srv/peerify/app/circles && ./deploy-staging.sh
exit
```

The deploy needs the host name `peerify-staging` or `peerify-prod`. For the rehearsal, it needs `peerify-staging-restore`.

Then the web side:
- **Real box loss:**
  - The files are in `/root/restore/etc/nginx` and `/root/restore/etc/letsencrypt`. Copy them in, or reissue the certificates with certbot.
  - Move the floating IP (or DNS) to the new box.
- **Rehearsal:**
  - Don't touch DNS.
  - Reach the app through an SSH tunnel: `ssh -N -L 3001:127.0.0.1:3001 ubuntu@<the VM's address>`.
  - Open `http://localhost:3001` in **Chrome or Firefox, not Safari.** The login cookie is marked secure: Chrome and Firefox accept it on `localhost`, but Safari doesn't, so the login would seem to fail.
  - **Look, don't use:** no posting, following, messages or invitations. The restored app has staging's push keys, so a notification could reach a real tester's browser.

### 5.9 Checks (the rehearsal's pass list)

**Box: the new VM** · **User: tim**

```
hostname
curl -fsS http://127.0.0.1:3001/api/health; echo
curl -fsS http://127.0.0.1:3001/api/version; echo
OBJ=$(sudo mcli --config-dir /root/.mcli ls --recursive restore/circles-staging | awk 'NR==1 {print $NF}')
echo "a public file through the app: $(curl -s -o /dev/null -w '%{http_code}, %{size_download} bytes' "http://127.0.0.1:3001/storage/$OBJ")"; unset OBJ
```

**You should see:**
- **health:** OK.
- **version:** the `gitSha` from 5.2.
- **The public file:** `200`, with more than 0 bytes. It comes from the VM's own silo through the app; its name is never printed.

**Compare the counts:** on the real staging box, run this into `~/counts-live.txt`. It asks for the `tim_admin` password.

```
mongosh --quiet "mongodb://tim_admin@127.0.0.1:27017/admin" --eval 'const d = db.getSiblingDB("peerify_staging"); d.getCollectionNames().sort().forEach(c => print(c, d[c].countDocuments()))' > ~/counts-live.txt
```

Then copy it and the VM's `counts-restored.txt` (from 5.4) to your Mac, and compare them with `diff -y --suppress-common-lines`. Small differences from activity since the snapshot are normal.

**In the browser** (through the tunnel), check:
- a test account can log in;
- a picture shows. Right-click it, then **Open image in new tab**: the address must start with `http://localhost:3001/`, so the picture really comes from the VM;
- a track plays;
- a private file opens in the admin view;
- `/admin/emails` opens, and any email the rehearsal triggered is there, not sent.

**Write down** in SESSION_LOG the time each step took, which steps needed help, and what was missing. Then:
- **In the Cleura dashboard, the same day:**
  - delete the VM;
  - check that **its volume** is gone (it holds a full copy of staging, keys included);
  - release the **floating IP**;
  - delete the rehearsal **security group**.
- **Clean up:**
  - on staging, `rm ~/counts-live.txt`;
  - on your Mac, the two counts files, and `ssh-keygen -R <the VM's address>`.

---

## 6. On-box restore check (prod; staging too if you like)

This proves the backups can be read in full, and that last night's snapshot restores to the same database, key files and bucket files as are live now. **Nothing is restored into the live database or the live folders.**

**Where things go:**
- Everything restored goes into one temporary folder, `/var/tmp/peerify-restore-test`.
- The database copy runs in a temporary second MongoDB on port 27099, as the `mongodb` user, with its data in that folder. The live MongoDB is only read, by the backup's own read-only user `peerify_backup`.
- Everything is shredded and deleted the same day.

**The two comparison scripts** are in this folder and are run from the deployed app:
- `restore-counts.mongosh.js`: documents per collection;
- `restore-files.sh`: files and bytes.

Both are read-only and print numbers only. **They refuse to run** if:
- `EXPECT_DB` / `EXPECT_BOX` is missing or wrong;
- the temporary MongoDB is on the live port;
- the temporary MongoDB doesn't keep its data under `/var/tmp/peerify-restore-test/`.

The commands below use prod's names. For staging:
- `--host peerify-staging`;
- `peerify_staging` instead of `circles` (in the archive name, `--nsInclude` and `EXPECT_DB`);
- `EXPECT_BOX=staging`.

**When:** in the daytime, not between 23:00 and 04:00. The full read in 6.2 must not overlap the nightly run.

### 6.1 Before you start

**Box: prod** · **User: tim**

```
hostname
S=/srv/peerify/app/circles/scripts/backup
sudo test -f $S/restore-counts.mongosh.js && sudo test -f $S/restore-files.sh && echo "scripts found"
sudo grep -E '===' /var/log/peerify-backup/backup.log | tail -n 2
sudo peerify-backup --restic stats --mode raw-data | grep -E 'Total Size'
for t in data buckets; do echo "$t: $(sudo peerify-backup --restic stats latest --host peerify-prod --tag $t | grep -E 'Total Size')"; done
echo "mongo: $(sudo peerify-backup --restic stats latest --host peerify-prod --tag mongo --path /var/backups/peerify/mongo/circles.archive | grep -E 'Total Size')"
df -h /var/tmp | tail -n 1
ls -d /var/tmp/peerify-restore-test 2>/dev/null && echo "STOP: an old test folder is still there" || echo "no old test folder"
ss -ltn | grep -q ':27099 ' && echo "STOP: port 27099 is in use" || echo "port 27099 free"
```

**You should see:**
- `scripts found`;
- last night's `=== ok after ...`;
- the raw-data size: how much 6.2 downloads;
- free space ("Avail") of at least **three times** data + buckets + mongo;
- `no old test folder` and `port 27099 free`.

### 6.2 Read and verify every byte

Run it in `tmux`, so a dropped connection doesn't stop it.

**Box: prod** · **User: tim**

```
hostname
tmux new -s restorecheck
```

Inside tmux:

```
sudo peerify-backup --restic check --read-data
```

**You should see:** `no errors were found`.

**Leaving and coming back:**
- **Leave it running:** `Ctrl-b`, then `d`.
- **Come back:** `tmux attach -t restorecheck`.
- **When it's done:** `exit`.

### 6.3 The database: temporary MongoDB, restore, compare

**What the folders are:**
- `/var/tmp/peerify-restore-test` itself only lets others pass through it.
- `restore/` is root-only.
- `db/` belongs to `mongodb`.

**Box: prod** · **User: tim**

```
hostname
T=/var/tmp/peerify-restore-test
sudo install -d -m 711 -o root -g root $T
sudo install -d -m 700 -o root -g root $T/restore
sudo install -d -m 700 -o mongodb -g mongodb $T/db
sudo bash -c "umask 077; peerify-backup --restic dump latest --host peerify-prod --tag mongo --path /var/backups/peerify/mongo/circles.archive /var/backups/peerify/mongo/circles.archive > $T/restore/circles.archive"
sudo stat -c '%s bytes' $T/restore/circles.archive
sudo grep "dumped 'circles'" /var/log/peerify-backup/backup.log | tail -n 1
```

**You should see:** the same number of bytes twice.

Start the temporary MongoDB:

```
T=/var/tmp/peerify-restore-test
ss -ltn | grep -q ':27099 ' && echo "STOP: port 27099 is in use" || sudo -u mongodb mongod --dbpath $T/db --port 27099 --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.25 --fork --logpath $T/db/mongod.log
pgrep -a mongod
```

**You should see:**
- `child process started successfully`;
- two `mongod` lines: the live one (`--config /etc/mongod.conf`) and the temporary one (`--port 27099`).

Restore the archive into it, then compare:

```
T=/var/tmp/peerify-restore-test
sudo mongorestore --host 127.0.0.1 --port 27099 --archive=$T/restore/circles.archive --nsInclude 'circles.*' 2>&1 | tail -n 1
sudo env EXPECT_DB=circles mongosh --nodb --norc --quiet --file /srv/peerify/app/circles/scripts/backup/restore-counts.mongosh.js | tee ~/restore-counts.txt
```

**You should see:**
- **The restore:** `0 document(s) failed to restore`. The temporary MongoDB needs no login and the live one does, so a mistyped port fails without writing anything.
- **The comparison:** a table of live, restored and the difference, per collection, then the totals.

**Reading it:**
- **Normal:**
  - `diff 0`;
  - small `more live` numbers;
  - a few `MORE IN THE BACKUP` in collections that are cleaned up over time, such as notifications.
- **Send me:**
  - big differences;
  - `only in the backup`;
  - an `only live` collection that isn't new;
  - any `Refusing to run`.

### 6.4 Key files and buckets: restore, compare

**Box: prod** · **User: tim**

```
hostname
T=/var/tmp/peerify-restore-test
for tag in data buckets; do (set -o pipefail; sudo peerify-backup --restic restore latest --host peerify-prod --tag $tag --target $T/restore | tail -n 1) || echo "FAILED: $tag"; done
sudo env EXPECT_BOX=prod bash /srv/peerify/app/circles/scripts/backup/restore-files.sh $T/restore | tee ~/restore-files.txt
```

**You should see:**
- two `Summary: Restored ...` lines;
- a table of files and bytes, live vs. restored, for the data folder, the account key folders and each bucket. The buckets are read with the backup's read-only silo key.

**Reading it:** equal, or the live numbers a little higher. Send me anything else, and any `cannot list` or `Refusing to run` line.

Copy `~/restore-counts.txt` and `~/restore-files.txt` to your Mac and send them.

### 6.5 Clean up, the same day

Stop the temporary MongoDB through its own data folder, so the command can't touch the live one:

**Box: prod** · **User: tim**

```
hostname
T=/var/tmp/peerify-restore-test
sudo -u mongodb mongod --dbpath $T/db --shutdown
sleep 3
pgrep -a mongod
```

**You should see:** only the live `mongod` line. If the temporary one is still listed after another 10 seconds, stop and send me the output. Don't kill anything by hand.

Shred and delete:

```
T=/var/tmp/peerify-restore-test
sudo find $T -type f -exec shred -u -n 1 {} +
sudo rm -rf $T
rm -f ~/restore-counts.txt ~/restore-files.txt
```

On a cloud disk, shredding can't guarantee that no old block survives in the provider's storage. The restored copy is no more sensitive than the live data on the same disk.

Final check:

```
hostname
ls -d /var/tmp/peerify-restore-test 2>/dev/null && echo "LEFT: test folder" || echo "test folder gone"
ss -ltn | grep -q ':27099 ' && echo "LEFT: something on port 27099" || echo "port 27099 closed"
echo "mongod processes: $(pgrep -c mongod)"
ls ~ | grep -E '^restore-' && echo "LEFT: files in your home" || echo "home clean"
echo "restic locks: $(sudo peerify-backup --restic list locks --no-lock | wc -l)"
```

**You should see:**
- `test folder gone`
- `port 27099 closed`
- `mongod processes: 1`
- `home clean`
- `restic locks: 0`

**Write down** in SESSION_LOG:
- the date and the snapshot ids;
- the result of 6.2;
- the totals from 6.3 and 6.4;
- that the final check was clean.

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
