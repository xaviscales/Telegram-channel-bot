# Telegram Channel MCP Server

A small remote MCP server that lets Claude read recent posts from, and post to,
one Telegram channel through a bot you control.

Tools it exposes to Claude:
- `get_recent_channel_posts` - posts captured since the bot joined as admin
- `send_channel_message` - post a text message to the channel
- `get_channel_info` - title, description, subscriber count

**Limitation:** a Telegram bot only sees channel activity from the moment it's
added as admin onward. It cannot retrieve the channel's history from before
that point. It also only reliably keeps the last ~24h / 100 unconfirmed
updates, so it should be deployed to run continuously (not spun up on demand)
for `get_recent_channel_posts` to stay populated.

## 1. Create the bot

1. Open Telegram, message **@BotFather**.
2. Send `/newbot`, follow the prompts (name, username ending in `bot`).
3. Copy the token it gives you (looks like `123456789:AA...`).

## 2. Add the bot to your channel

1. Open your channel's settings -> Administrators -> Add Admin.
2. Search for your bot's username, add it.
3. Give it at least "Post Messages" permission (and any others you want it
   to use). Read access to new posts comes automatically once it's an admin.

## 3. Deploy

### Option A: Railway (free tier, no server management)

1. Push this folder to a new GitHub repo (or use Railway's CLI to deploy the
   folder directly without git).
2. At railway.app, "New Project" -> "Deploy from GitHub repo" -> pick the repo.
3. In the Railway project's Variables tab, add:
   - `TELEGRAM_BOT_TOKEN` = the token from step 1
   - `TELEGRAM_CHANNEL_ID` = your channel's `@username`, or its numeric chat
     id if it's private (get this by forwarding a channel post to
     @userinfobot, or via the bot's own `getUpdates` once it has an update)
   - `MCP_SECRET` = any long random string you generate yourself, e.g. run
     `openssl rand -hex 24` locally
4. Railway auto-detects Node and runs `npm start`. Once deployed, open
   Settings -> Networking -> "Generate Domain" to get a public URL like
   `https://your-app.up.railway.app`.
5. Your MCP connector URL is:
   `https://your-app.up.railway.app/mcp/<your MCP_SECRET>`

### Option B: any VPS you already run

1. Copy this folder to the server.
2. `npm install`
3. Set the three env vars (export them, or use a `.env` file with a process
   manager like `pm2` that loads it).
4. Run it under a process manager so it survives reboots/crashes:
   `pm2 start server.js --name telegram-mcp`
5. Put it behind a reverse proxy (e.g. Caddy or nginx) with HTTPS - Claude's
   connectors require a public `https://` URL.
6. Your connector URL is `https://your-domain.com/mcp/<your MCP_SECRET>`

## 4. Connect it to Claude

1. In Claude, go to Settings (or Customize) -> Connectors -> "+ Add custom
   connector".
2. Paste the full URL from step 3, including the `/mcp/<secret>` path.
3. Name it (e.g. "Telegram Channel"), save.
4. Enable it for a conversation via the "+" button -> Connectors.
5. Test by asking Claude something like "what's the latest post in my
   Telegram channel" or "post X to my Telegram channel".

## Security note

The `MCP_SECRET` path segment is a lightweight shared secret, not full auth.
Anyone with the exact URL can call your bot. Keep the URL private the same
way you'd keep an API key private, and rotate `MCP_SECRET` (redeploy with a
new value) if you ever think it's leaked.
