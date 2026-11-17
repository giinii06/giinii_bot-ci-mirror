---
name: deploy
description: Ship this repo to the ocp server and restart the bot container. Use when the user says deploy, 배포, /deploy, "서버에 올려", or asks to push and rebuild giinii_bot.
allowed-tools: Bash, Read
---

# Deploy

Push `main`, fast-forward the checkout on ocp, rebuild the image, restart the container, then prove it is alive.

The SSH target is `ubuntu@140.245.73.42` with `~/.ssh/ocp.key`, the same as the `ocp` alias in `~/.zshrc`. Aliases do not load in non-interactive shells, so spell the command out.

## 1. Preflight

```sh
git status --short
git log --oneline origin/main..HEAD
```

Stop and ask if a tracked file is modified or staged. Untracked `.audit/` is expected. Report the commits that will ship.

## 2. Push

```sh
git push origin main
```

If the push is rejected, stop. Never force-push `main`.

## 3. Pull on the server

```sh
ssh -i ~/.ssh/ocp.key ubuntu@140.245.73.42 \
  'cd ~/cod/giinii_bot && git pull --ff-only origin main'
```

`--ff-only` makes a diverged server checkout fail loudly instead of merging. The server keeps untracked `.audit/`, `.commandcode/`, and `test/fixtures/`. Leave them.

## 4. Rebuild and restart

```sh
ssh -i ~/.ssh/ocp.key ubuntu@140.245.73.42 \
  'cd ~/cod/giinii_bot && docker compose up -d --build'
```

Compose project `giinii_bot`, service `bot`, container `giinii_bot-bot-1`. `./data` is bind-mounted, so a rebuild leaves every guild database alone. `skipping seed restore` in the logs is normal for an existing database.

## 5. Verify

```sh
ssh -i ~/.ssh/ocp.key ubuntu@140.245.73.42 \
  'docker ps --filter name=giinii_bot --format "{{.Names}} {{.Status}}"; docker logs --tail 40 giinii_bot-bot-1'
```

Pass requires all three.

- The container shows `Up`.
- The logs contain `Logged in as`.
- No stack trace after the login line.

`Registered N slash commands in global` means a command description changed and Discord re-registered it. Its absence means no command changed.

## 6. Report

Name the commit hash now running, the container status, and any log line that looks wrong. Report a failed step with its command and its output. Do not retry it with force flags or a reset.
