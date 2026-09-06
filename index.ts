import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

import { forSite, SearchResults } from "booru";
import { GelbooruDB } from "./lib/db.ts";
import { createSubtagQueriesFromTags } from "./lib/subqueries.ts";
import { retryWithBackoff } from "./lib/retry.ts";
import { grabTagsFromFile } from "./lib/tags.ts";
import { subqueryToTags } from "./lib/subqueries.ts";

const {
  values,
}: {
  values: {
    tags?: string[];
    tagPath?: string; // the path for the tag list to scan
    timeoutMs?: string;
    importTags?: boolean;
    testTags?: boolean;
    bypassLimit?: boolean;
  };
} = parseArgs({
  options: {
    tags: { type: "string", multiple: true },
    timeoutMs: { type: "string" },
    importTags: { type: "boolean", default: false },
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

const timeoutMs = parseInt(values.timeoutMs ?? "1000");
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

const tagSubQueries = [];
for (const tags of tagQueries) {
  await setTimeout(1000);
  const subqueries = await createSubtagQueriesFromTags(gb, tags, MAX_SCORE);
  tagSubQueries.push({ query: tags, subqueries });
  console.log(
    `Original tags=${tags}, max score: ${subqueries.at(-1)!.score.n}`,
  );
}

if (values.importTags) {
  await db.importTagsFromFile("./resources/gelbooru_tags_2026-06-11.jsonl");
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

// ================== TAG GRABBING ==================
for (const { query, subqueries } of finalQueries) {
  const queryCount = await retryWithBackoff(
    () => gb.getPostCount(query),
    `getPostCount(${query.join(",")})`,
  );
  console.log(
    `The original tag query ${query} has a total estimated count of ${queryCount}..`,
  );

  for (const tags of subqueries) {
    await setTimeout(1000);

    // logging.
    let estimatedCount = -1;
    try {
      estimatedCount = await retryWithBackoff(
        () => gb.getPostCount(tags),
        `getPostCount(${tags.join(",")})`,
      );
    } catch {
      // ignore
    }
    if (estimatedCount <= 0) {
      console.warn(`Tag=${tags} has no results! Might be an invalid tag ..`);
      continue;
    }

    console.log(
      `Tag=${tags}, estimated count: ${estimatedCount >= 0 ? estimatedCount : "unknown"}`,
    );

    if (testTags) continue;

    // Fetch pages until empty
    console.log(`\t- Downloading tag=${tags}...`);
    let page = 0;
    const postsPerPage = 100;
    let hasMore = true;

    while (hasMore) {
      await setTimeout(timeoutMs);
      let posts: SearchResults | undefined = undefined;
      try {
        posts = await retryWithBackoff(
          () => gb.search(tags, { limit: postsPerPage, page }),
          `search(${tags.join(",")}, page ${page + 1})`,
        );
      } catch (err: any) {
        const msg = err.message || "";
        if (msg.includes("Too deep") || msg.includes("JSON")) {
          console.error(`\tToo deep - stopping for ${tags} at page ${page}.`);
          break;
        }
        console.error(`\tError on page ${page} for ${tags}:`, err);
        break; // break to avoid infinite loop on persistent errors
      }

      if (posts.length === 0) {
        break;
      }

      // Insert batch
      db.insertPosts(posts);
      console.log(`\t- Page ${page + 1} fetched (${posts.length} posts)`);

      // If we got fewer than the limit, we've reached the last page
      if (posts.length < postsPerPage) {
        break;
      }

      page++;
    }

    console.log(`\tFinished downloading ${tags.join(",")}`);
  }
}
console.log("Finished.");
