import { config } from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import cron from "node-cron";
import OpenAI from "openai";
import { addPost, listPosts, getDuePosts, updatePost } from "./store.js";

config();

const MAX_TWEET_LENGTH = 280;

let openai;
function getOpenAI() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

function getTwitterClient() {
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
}

// MCP tools return content as a list of text blocks.
function reply(text) {
  return { content: [{ type: "text", text }] };
}

// Returns true if OpenAI's moderation model flags the text.
// If the check itself fails, we treat the text as unsafe (fail safe).
async function isUnsafe(text) {
  try {
    const result = await getOpenAI().moderations.create({ input: text });
    return result.results[0].flagged;
  } catch (err) {
    console.error("Moderation API error:", err.message);
    return true;
  }
}

async function publish(text) {
  await getTwitterClient().v2.tweet(text);
}

// ---------- MCP tools ----------

export async function createPost(text, delayInMinutes = 0) {
  if (text.length > MAX_TWEET_LENGTH) {
    return reply(`❌ Tweet is ${text.length} characters. The limit is ${MAX_TWEET_LENGTH}.`);
  }

  if (await isUnsafe(text)) {
    return reply("❌ Content rejected by moderation filter.");
  }

  if (delayInMinutes > 0) {
    const scheduledFor = new Date(Date.now() + delayInMinutes * 60_000);
    const post = await addPost(text, scheduledFor);
    return reply(
      `🕒 Scheduled (id: ${post.id}) for ${scheduledFor.toLocaleString()}.`
    );
  }

  try {
    await publish(text);
    return reply(`✅ Tweeted: ${text}`);
  } catch (err) {
    return reply(`❌ Failed to tweet: ${err.message}`);
  }
}

export async function listScheduledPosts() {
  const pending = await listPosts("pending");
  if (pending.length === 0) return reply("No scheduled posts.");

  const lines = pending.map(
    (p) => `• ${p.id} at ${new Date(p.scheduledFor).toLocaleString()}: "${p.text}"`
  );
  return reply(`Scheduled posts:\n${lines.join("\n")}`);
}

export async function cancelScheduledPost(id) {
  const [post] = (await listPosts("pending")).filter((p) => p.id === id);
  if (!post) return reply(`❌ No pending post with id ${id}.`);

  await updatePost(id, { status: "cancelled" });
  return reply(`🗑️ Cancelled scheduled post ${id}.`);
}

// ---------- Background worker ----------

// Every minute, publish any scheduled posts that are due.
// Because posts live in a file, nothing is lost if the server restarts.
export function startScheduler() {
  cron.schedule("* * * * *", async () => {
    const due = await getDuePosts();
    for (const post of due) {
      try {
        await publish(post.text);
        await updatePost(post.id, { status: "posted", postedAt: new Date().toISOString() });
        console.log(`✅ Posted scheduled tweet ${post.id}`);
      } catch (err) {
        await updatePost(post.id, { status: "failed", error: err.message });
        console.error(`❌ Failed to post ${post.id}:`, err.message);
      }
    }
  });
  console.log("Scheduler running (checks for due posts every minute)");
}
