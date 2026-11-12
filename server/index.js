import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import {
  createPost,
  listScheduledPosts,
  cancelScheduledPost,
  startScheduler,
} from "./mcp.tool.js";

const PORT = process.env.PORT || 3001;

const server = new McpServer({
  name: "tweetguard",
  version: "1.1.0",
});

server.tool(
  "createPost",
  "Post a tweet on X (formerly Twitter) now, or schedule it for later. Content is checked by a moderation filter first.",
  {
    status: z.string().min(1).describe("The tweet text"),
    delayInMinutes: z
      .number()
      .min(0)
      .optional()
      .describe("Minutes from now to post. Leave out to post immediately."),
  },
  async ({ status, delayInMinutes }) => createPost(status, delayInMinutes)
);

server.tool(
  "listScheduledPosts",
  "List tweets that are scheduled but not yet posted.",
  {},
  async () => listScheduledPosts()
);

server.tool(
  "cancelScheduledPost",
  "Cancel a scheduled tweet by its id.",
  { id: z.string().describe("The id of the scheduled post") },
  async ({ id }) => cancelScheduledPost(id)
);

const app = express();

// One SSE connection per client session.
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No transport found for sessionId");
  }
});

startScheduler();

app.listen(PORT, () => {
  console.log(`TweetGuard MCP server running on http://localhost:${PORT}`);
});
