import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

import { forSite } from "booru";
import { GelbooruDB } from "./lib/db.ts";
import { createSubtagQueriesFromTags } from "./lib/subqueries.ts";
import { grabTagsFromFile, importPostsIntoDB } from "./lib/tags.ts";
import { subqueryToTags } from "./lib/subqueries.ts";
import { downloadImage } from "./lib/image.ts";

const {
  values,
}: {
  values: {
    tags?: string[]; // the tag list.
    timeoutMs?: string; // how much timeout there should be between requests.
    importTags?: boolean; // if to import tags from a JSONL file, linked in the README.md
    downloadPosts?: boolean; // if the program should download posts and shove it into a db.
    downloadImages?: boolean; // if the program should scan that db to download images.
    testTags?: boolean; // if to test if the tags you put in works with gelbooru's API.
    bypassLimit?: boolean; // if to bypass the 10,000 post limit gelbooru has.
    tagPath?: string; // the path for the tag list to scan
  };
} = parseArgs({
  options: {
    tags: { type: "string", multiple: true },
    timeoutMs: { type: "string" },
    importTags: { type: "boolean", default: false },
    downloadPosts: { type: "boolean", default: false },
    downloadImages: { type: "boolean", default: false },
    testTags: { type: "boolean", default: false },
    bypassLimit: { type: "boolean", default: false },
    tagPath: { type: "string" },
  },
  allowPositionals: true,
});

const MAX_SCORE = 1000;
const GELBOORU_API_KEY = process.env.GELBOORU_API_KEY;
const GELBOORU_USER_ID = process.env.GELBOORU_USER_ID;

if (!GELBOORU_API_KEY || !GELBOORU_USER_ID) {
  throw new Error("No keys!");
}

const timeoutMs = parseInt(values.timeoutMs ?? "1500");
const testTags = values.testTags ?? false;
const bypassLimit = values.bypassLimit ?? false;

// ================== TAG BUILDING ==================
const tags = values.tags ?? [];
const tagPath = values.tagPath;

async function splitTags() {
  const fileTags = tagPath !== undefined ? await grabTagsFromFile(tagPath) : [];
  const cmdLineTags = tags.map((c) => {
    if (typeof c !== "string") {
      console.error("Tags are not a string!");
      process.exit(1);
    }
    return c.split(" ");
  });

  return tagPath ? fileTags : cmdLineTags;
}

const tagQueries = await splitTags();

if (tagQueries.length <= 0) {
  console.error("No tags were passed in!");
  process.exit(1);
} else {
  console.log(`No. of queries: ${tagQueries.length}`);
}

// =============== MAIN ================

const db = new GelbooruDB("./db/gelbooru.sqlite3");
const gb = forSite("gelbooru", {
  user_id: GELBOORU_USER_ID,
  api_key: GELBOORU_API_KEY,
});

if (values.importTags) {
  await db.importTagsFromFile("./resources/gelbooru_tags_2026-06-11.jsonl");
}

let tagSubQueries = [];
if (bypassLimit) {
  for (const tags of tagQueries) {
    await setTimeout(1000);
    const subqueries = await createSubtagQueriesFromTags(gb, tags, MAX_SCORE);
    tagSubQueries.push({ query: tags, subqueries });
    console.log(
      `Original tags=${tags}, max score: ${subqueries.at(-1)!.score.n}`,
    );
  }
}

const finalQueries = bypassLimit
  ? tagSubQueries.map((c) => ({
      query: c.query,
      subqueries: c.subqueries.map(subqueryToTags),
    }))
  : tagQueries.map((c) => ({
      query: c,
      subqueries: [],
    }));

if (testTags) {
  console.warn(`WARNING!! No posts will be downloaded since testTags is on!`);
}

if (values.downloadPosts) {
  await importPostsIntoDB(gb, db, finalQueries, timeoutMs, testTags);
}

if (values.downloadImages) {
  for (const { query } of finalQueries) {
    for await (const posts of db.getPostsFromTag(query)) {
      for (const post of posts) {
        console.log(
          `Downloading post id ${post.id} created at ${post.createdAt}.`,
        );
        if (!post.fileUrl) {
          console.error(
            `Post id ${post.id} doesn't have a fileUrl and was not downloaded.`,
          );
          continue;
        }
        await downloadImage(post.fileUrl, { referrer: "https://gelbooru.com" });
        await setTimeout(timeoutMs);
      }
    }
  }
}

if (!values.downloadImages && !values.downloadPosts) {
  console.log(
    "Please add --downloadImages or --downloadPosts and add a --tags section.",
  );
}

// ================== TAG GRABBING ==================
console.log("Finished.");
