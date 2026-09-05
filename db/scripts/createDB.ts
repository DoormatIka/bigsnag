import Database from "better-sqlite3";

const db = new Database("./db/gelbooru.sqlite3", {
  verbose: console.log,
});
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const createPosts = db.prepare(`
CREATE TABLE "posts" (
	"id"	TEXT NOT NULL,
	"height"	INTEGER NOT NULL,
	"width"	INTEGER NOT NULL,
	"available"	INTEGER NOT NULL CHECK("available" IN (0, 1)),
	"fileUrl"	TEXT,
	"sampleUrl"	TEXT,
	"sampleHeight"	INTEGER,
	"sampleWidth"	INTEGER,
	"previewUrl"	TEXT,
	"previewHeight"	INTEGER,
	"previewWidth"	INTEGER,
	"tags"	TEXT NOT NULL COLLATE RTRIM,
	"score"	INTEGER NOT NULL,
	"source"	TEXT,
	"rating"	TEXT NOT NULL CHECK("rating" IN ('s', 'q', 'e', 'u', 'g')),
	"createdAt"	TEXT,
	PRIMARY KEY("id")
) STRICT
`);
const createTags = db.prepare(`
CREATE TABLE "tags" (
	"id"	INTEGER NOT NULL UNIQUE,
	"name"	TEXT NOT NULL UNIQUE,
	"post_count"	INTEGER NOT NULL DEFAULT 0,
	"category_id"	INTEGER NOT NULL DEFAULT 6,
	"is_ambiguous"	INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY("id")
) STRICT
`);
const createPostTagJunction = db.prepare(`
CREATE TABLE "post_tags" (
	"post_id" TEXT NOT NULL,
	"tag_id" INTEGER NOT NULL,
	PRIMARY KEY("post_id", "tag_id"),
	FOREIGN KEY("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
	FOREIGN KEY("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
) STRICT;
`);
const createIndexes = db.prepare(`
CREATE INDEX idx_tags_category_post_count ON tags(category_id, post_count DESC);
CREATE INDEX idx_tags_name ON tags(name);
`);
// maybe normalize the category id soon?
const createDatabase = db.transaction(() => {
  createTags.run();
  createPosts.run();
  createPostTagJunction.run();
  createIndexes.run();
});
// [[ ============ DB CREATE ============= ]]

createDatabase();
