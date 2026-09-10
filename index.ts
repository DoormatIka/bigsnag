import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

import { forSite } from "booru";
import { GelbooruDB } from "./lib/db.ts";
import { createSubtagQueriesFromTags } from "./lib/subqueries.ts";
import { grabTagsFromFile, importPostsIntoDB } from "./lib/posts.ts";
import { subqueryToTags } from "./lib/subqueries.ts";
import {
  getRelativePathFromUrl,
  resolveStoredPath,
  ensureDirectoryExists,
  downloadImage,
  convertAny,
} from "./lib/image.ts";
import path from "node:path";

const {
  values,
}: {
  values: {
    tags?: string[]; // the tag list.
    timeoutMs?: string; // how much timeout there should be between requests.
    importTagFile?: string; // the file name under (location)/resources/(importTagFile) to import for tags, linked in the README.md
    downloadPosts?: boolean; // if the program should download posts and shove it into a db.
    downloadImages?: boolean; // if the program should scan that db to download images.
    downloadPageCount?: string; // how many images should be downloaded per tag query.
    compressMedia?: boolean; // compresses images into webp for massive space savings.
    location?: string; // db and image location..
    testTags?: boolean; // if to test if the tags you put in works with gelbooru's API.
    bypassLimit?: boolean; // if to bypass the 10,000 post limit gelbooru has.
    tagPath?: string; // the path for the tag list to scan
  };
} = parseArgs({
  options: {
    tags: { type: "string", multiple: true },
    timeoutMs: { type: "string" },
    importTagFile: { type: "string" },
    downloadPosts: { type: "boolean", default: false },
    downloadImages: { type: "boolean", default: false },
    downloadPageCount: { type: "string" },
    compressMedia: { type: "boolean", default: false },
    location: { type: "string" },
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
const location = values.location ?? process.cwd();
const downloadPageCount = Number.parseInt(values.downloadPageCount!);
const compressMedia = values.compressMedia;

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

if (Number.isNaN(downloadPageCount)) {
  console.log(
    `Flag --downloadPageCount is not set. This will download all images in a query if you have --downloadImages set.`,
  );
}

const tagQueries = await splitTags();

if (tagQueries.length <= 0) {
  console.error("No tags were passed in!");
  process.exit(1);
} else {
  console.log(`No. of queries: ${tagQueries.length}`);
}

// =============== MAIN ================

const dbPath = path.join(location, "./db/gelbooru.sqlite3");

const gelbooruDB = new GelbooruDB(dbPath);
const gb = forSite("gelbooru", {
  user_id: GELBOORU_USER_ID,
  api_key: GELBOORU_API_KEY,
});

if (values.importTagFile) {
  const tagListFile = path.join(location, "./resources", values.importTagFile);
  console.log(
    "If you already imported your posts and tags, you must delete the existing database and start anew.",
    "\nI do not have a migration script yet to update tags securely.",

    "\n\nIf you do not have a backup of your database, **create one now**. Ctrl+C this program if you haven't created one yet.",
    "\nThere is a minute delay before this and the actual tag updating scheme.",
  );
  await setTimeout(60_000);
  await gelbooruDB.importTagsFromFile(tagListFile);
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
  await importPostsIntoDB(
    gb,
    gelbooruDB,
    finalQueries,
    timeoutMs,
    testTags,
    downloadPageCount,
  );
}

if (values.downloadImages) {
  for (const { query } of finalQueries) {
    let page = 1;
    for await (const { posts, offset } of gelbooruDB.getPostsFromTag(query)) {
      console.log(`On page ${page}, offset ${offset}.`);

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
        const relativePath = getRelativePathFromUrl(post.fileUrl);
        const resolvedPath = resolveStoredPath(relativePath, location);

        ensureDirectoryExists(resolvedPath);

        const convertedRelativePath = compressMedia
          ? await convertAny(location, resolvedPath)
          : relativePath;

        if (!testTags) {
          await downloadImage(post.fileUrl, resolvedPath, {
            referrer: "https://gelbooru.com",
          });

          gelbooruDB.insertImageMeta({
            post_id: post.id,
            relative_folder: path.dirname(convertedRelativePath),
            filename: path.basename(convertedRelativePath),
          });
        }

        console.log(
          `Saved under set location: "${location}"\n\trelative path: "${convertedRelativePath}".`,
        );
        await setTimeout(timeoutMs);
      }

      if (!Number.isNaN(downloadPageCount) && page > downloadPageCount - 1) {
        console.log(
          `Image limit ${downloadPageCount} reached, moving onto next query...`,
        );
        break;
      }
      page += 1;
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
