const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { z } = require('zod');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // e.g. @yourchannel or -1001234567890
const MCP_SECRET = process.env.MCP_SECRET; // long random string, part of the connector URL

if (!BOT_TOKEN || !CHANNEL_ID || !MCP_SECRET) {
  console.error('Missing required env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, MCP_SECRET');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

let updateOffset = 0;
const seenPosts = []; // in-memory cache, newest last, capped at 500

async function tgCall(method, params = {}) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error (${method}): ${data.description}`);
  return data.result;
}

// Long-polls Telegram for new channel posts. Only sees posts made after the
// bot was added as a channel admin, and only while updates haven't already
// been consumed or expired (Telegram keeps unconfirmed updates ~24h, cap 100).
async function pollUpdates() {
  try {
    const updates = await tgCall('getUpdates', {
      offset: updateOffset,
      timeout: 0,
      allowed_updates: ['channel_post']
    });
    for (const u of updates) {
      updateOffset = u.update_id + 1;
      if (u.channel_post) {
        seenPosts.push({
          message_id: u.channel_post.message_id,
          date: new Date(u.channel_post.date * 1000).toISOString(),
          text: u.channel_post.text || u.channel_post.caption || '[non-text post]'
        });
        if (seenPosts.length > 500) seenPosts.shift();
      }
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
}
setInterval(pollUpdates, 15000);
pollUpdates();

function getServer() {
  const server = new McpServer({ name: 'telegram-channel-mcp', version: '1.0.0' });

  server.registerTool(
    'get_recent_channel_posts',
    {
      description:
        'Get the most recent posts captured from the Telegram channel since this bot was added as admin. ' +
        'Does not include posts made before the bot joined.',
      inputSchema: {
        limit: z.number().min(1).max(200).default(20).describe('Max number of recent posts to return')
      }
    },
    async ({ limit }) => {
      await pollUpdates();
      const posts = seenPosts.slice(-limit).reverse();
      return { content: [{ type: 'text', text: JSON.stringify(posts, null, 2) }] };
    }
  );

  server.registerTool(
    'send_channel_message',
    {
      description: 'Post a text message to the Telegram channel.',
      inputSchema: {
        text: z.string().min(1).describe('Message text to post to the channel')
      }
    },
    async ({ text }) => {
      const result = await tgCall('sendMessage', { chat_id: CHANNEL_ID, text });
      return { content: [{ type: 'text', text: `Posted message ${result.message_id} to the channel.` }] };
    }
  );

  server.registerTool(
    'get_channel_info',
    {
      description: 'Get basic info about the connected Telegram channel: title, description, subscriber count.',
      inputSchema: {}
    },
    async () => {
      const chat = await tgCall('getChat', { chat_id: CHANNEL_ID });
      let memberCount = null;
      try {
        memberCount = await tgCall('getChatMemberCount', { chat_id: CHANNEL_ID });
      } catch (e) {
        // ignore, not critical
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { title: chat.title, description: chat.description || null, subscriber_count: memberCount },
              null,
              2
            )
          }
        ]
      };
    }
  );

  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });

app.get('/', (req, res) => res.send('Telegram channel MCP server is running.'));

app.post('/mcp/:secret', async (req, res) => {
  if (req.params.secret !== MCP_SECRET) {
    return res.status(404).end();
  }
  const server = getServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.get('/mcp/:secret', (req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
});
app.delete('/mcp/:secret', (req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Telegram MCP server listening on port ${PORT}`);
});
