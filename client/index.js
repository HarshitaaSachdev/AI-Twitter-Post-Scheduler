import { config } from "dotenv";
import readline from "readline/promises";
import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

config();

const SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3001/sse";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_PROMPT = `You are TweetGuard, an assistant that helps the user post and schedule tweets.
Use the available tools to post, schedule, list or cancel tweets.
If the user asks to post something, write the tweet exactly as they asked unless they ask you to draft it.
Keep replies short.`;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const mcpClient = new Client({ name: "tweetguard-client", version: "1.1.0" });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const chatHistory = [];
let tools = [];

// Convert the MCP tool list into Gemini function declarations.
async function loadTools() {
  const { tools: mcpTools } = await mcpClient.listTools();
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: tool.inputSchema.type,
      properties: tool.inputSchema.properties,
      required: tool.inputSchema.required,
    },
  }));
}

async function askModel() {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: chatHistory,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: tools }],
    },
  });
  return response.candidates?.[0]?.content?.parts ?? [];
}

// Keep calling the model until it answers in text instead of asking for a tool.
async function handleTurn() {
  for (let step = 0; step < 5; step++) {
    const parts = await askModel();
    const call = parts.find((p) => p.functionCall)?.functionCall;

    if (!call) {
      const text = parts.map((p) => p.text).filter(Boolean).join("\n");
      chatHistory.push({ role: "model", parts: [{ text }] });
      console.log(`AI: ${text}`);
      return;
    }

    console.log(`→ calling tool ${call.name}`);
    chatHistory.push({ role: "model", parts: [{ functionCall: call }] });

    const result = await mcpClient.callTool({ name: call.name, arguments: call.args ?? {} });
    const output = result.content.map((c) => c.text).join("\n");

    chatHistory.push({
      role: "user",
      parts: [{ functionResponse: { name: call.name, response: { output } } }],
    });
  }
  console.log("AI: Stopped after too many tool calls.");
}

async function main() {
  await mcpClient.connect(new SSEClientTransport(new URL(SERVER_URL)));
  tools = await loadTools();
  console.log(`Connected to TweetGuard. Tools: ${tools.map((t) => t.name).join(", ")}`);
  console.log('Type a message, or "exit" to quit.\n');

  while (true) {
    const question = (await rl.question("You: ")).trim();
    if (!question) continue;
    if (question.toLowerCase() === "exit") break;

    chatHistory.push({ role: "user", parts: [{ text: question }] });
    try {
      await handleTurn();
    } catch (err) {
      console.error("Error:", err.message);
    }
  }

  rl.close();
  await mcpClient.close();
}

main().catch((err) => {
  console.error("Could not start client:", err.message);
  console.error("Is the server running? Start it with: cd server && npm start");
  process.exit(1);
});
