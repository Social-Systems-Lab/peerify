# Run sheet: cross-circle task action check (read-only)

**What it does:** lists task and shift actions made by someone who isn't the author, an admin or moderator of the task's own circle, the owner of a personal circle, or a platform admin, as far as the stored data shows. The kinds of action are:
- confirmations;
- attendance;
- claim reviews;
- claim approvals;
- changes requested;
- completion;
- accept or submit by someone other than the assignee;
- assignments and stage changes (from notifications).

It prints counts, then task ids with the kind, the reason and the date. It prints no names, DIDs, emails or addresses. **It only reads.**

**Limits:**
- Deleted tasks and priority changes leave no trace.
- An assignment or stage change only shows if a notification was stored.
- Roles are today's, so someone removed as moderator since then shows as `member_not_manager`.

## On prod, before the fix is deployed (prod runs `60108f48`, which doesn't have the script)

The two files are in the archive under `prod-check/`. The steps:

1. **On your Mac,** after unpacking the archive in `~/Downloads`:
   ```
   scp -r ~/Downloads/20261116-task-actions-circle-check/prod-check peerify-prod:/tmp/xcheck
   ```
2. **On peerify-prod, as yourself (not peerify):**
   ```
   ln -s /srv/peerify/app/circles/node_modules /tmp/xcheck/node_modules
   ```
3. **Still on peerify-prod:**
   ```
   sudo -iu peerify
   ```
   Then:
   ```
   cd /tmp/xcheck && (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=circles bun scripts/check-cross-circle-task-actions.ts)
   ```
   - The first line says `Database: circles. Read-only; nothing was written.`
   - If it says "Refusing to run", paste me the line.
4. **Clean up:** `exit` (back to yourself), then:
   ```
   rm -r /tmp/xcheck
   ```

Paste me the output. It has no personal data in it.

## Once the branch is deployed (staging or prod)
On the box, `sudo -iu peerify`, then:
```
cd /srv/peerify/app/circles && (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=<circles on prod, peerify_staging on staging> bun scripts/check-cross-circle-task-actions.ts)
```

## Reading the result
- **`not_member`:** the actor isn't even a member of the task's circle. That's the clearest sign the gap was used, or that roles changed.
- **`member_not_manager`:** a member, but not an admin or moderator today. It can be legitimate if the circle's access rules give tasks rights to other groups, or the person was a moderator then.
- **`not_assignee`:** accept or submit for review by someone other than the assignee.
- **`FLAGGED: 0`:** nothing in the stored data points to the gap being used.
