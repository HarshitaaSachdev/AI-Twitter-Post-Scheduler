import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Scheduled posts are saved to a JSON file so they survive server restarts.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "scheduled-posts.json");

async function readAll() {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(posts) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(posts, null, 2));
}

export async function addPost(text, scheduledFor) {
  const posts = await readAll();
  const post = {
    id: randomUUID().slice(0, 8),
    text,
    scheduledFor: scheduledFor.toISOString(),
    status: "pending", // pending | posted | failed | cancelled
    createdAt: new Date().toISOString(),
  };
  posts.push(post);
  await writeAll(posts);
  return post;
}

export async function listPosts(status) {
  const posts = await readAll();
  return status ? posts.filter((p) => p.status === status) : posts;
}

export async function getDuePosts(now = new Date()) {
  const posts = await readAll();
  return posts.filter(
    (p) => p.status === "pending" && new Date(p.scheduledFor) <= now
  );
}

export async function updatePost(id, changes) {
  const posts = await readAll();
  const post = posts.find((p) => p.id === id);
  if (!post) return null;
  Object.assign(post, changes);
  await writeAll(posts);
  return post;
}
