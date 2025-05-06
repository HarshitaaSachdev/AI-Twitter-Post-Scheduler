import { config } from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import cron from "node-cron";
import OpenAI from "openai";

config();

// Create OpenAI instance
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper to check content moderation
async function isUnsafe(text) {
  try {
    const result = await openai.moderations.create({ input: text });
    return result.results[0].flagged;
  } catch (err) {
    console.error("Moderation API error:", err.message);
    return true; // Assume unsafe on error
  }
}

// Helper to create fresh Twitter client
function getTwitterClient() {
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
  });
}

// Exported tool
export async function createPost(status, delayInMinutes = 0) {
  if (await isUnsafe(status)) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Content rejected by moderation filter.`,
        },
      ],
    };
  }

  if (delayInMinutes > 0) {
    const scheduledTime = new Date(Date.now() + delayInMinutes * 60000);
    const cronTime = `${scheduledTime.getMinutes()} ${scheduledTime.getHours()} ${scheduledTime.getDate()} ${scheduledTime.getMonth() + 1} *`;

    const task = cron.schedule(cronTime, async () => {
      try {
        const client = getTwitterClient();
        await client.v2.tweet(status);
        console.log("✅ Scheduled tweet posted:", status);
      } catch (err) {
        console.error("❌ Failed to post scheduled tweet:", err.message);
      } finally {
        task.stop();
      }
    });

    return {
      content: [
        {
          type: "text",
          text: `🕒 Tweet scheduled for ${scheduledTime.toLocaleTimeString()}`,
        },
      ],
    };
  } else {
    try {
      const client = getTwitterClient();
      await client.v2.tweet(status);
      return {
        content: [
          {
            type: "text",
            text: `✅ Tweeted: ${status}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to tweet: ${err.message}`,
          },
        ],
      };
    }
  }
}
