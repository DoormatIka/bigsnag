import fs from "fs";
import readline from "readline";

import { retryWithBackoff } from "./retry.ts";
import { setTimeout } from "node:timers/promises";
import { SearchResults, type BooruClass } from "booru";
import type { GelbooruDB } from "./db.ts";

export async function importPostsIntoDB(
  gb: BooruClass,
  db: GelbooruDB,
  finalQueries: {
    query: string[];
    subqueries: string[][];
  }[],
  timeoutMs: number,
  testTags: boolean,
) {
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
}

// [ ===================================== ]

export async function grabTagsFromFile(file: string) {
  console.log(`Grabbing user tags from ${file}...`);
  const tagList: string[][] = [];

  const fileStream = fs.createReadStream(file);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length <= 0) continue;

    const tags = trimmed.split(" ");
    tagList.push(tags);
  }

  return tagList;
}

// [ ====================================== ]
