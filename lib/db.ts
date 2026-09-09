import Sqlite3, { type Statement } from "better-sqlite3";
import { Post } from "booru";
import * as fs from "fs";
import * as readline from "readline";

export type DBPost = {
  id: string;
  height: number;
  width: number;
  available: number;
  fileUrl: string | null;
  sampleUrl: string | null;
  sampleHeight: number | null;
  sampleWidth: number | null;
  previewUrl: string | null;
  previewHeight: number | null;
  previewWidth: number | null;
  tags: string;
  score: number;
  source: string | undefined;
  rating: string;
  createdAt: string | null;
};

export type DBTag = {
  id: number;
  name: string;
  post_count: number;
  category_id: number;
  is_ambiguous: number;
};

export type DBImageMeta = {
  post_id: string;
  relative_folder: string;
  filename: string;
};

function mapPostToInsert(post: Post): DBPost {
  return {
    id: post.id,
    height: post.height,
    width: post.width,
    available: post.available ? 1 : 0,

    fileUrl: post.fileUrl,
    sampleUrl: post.sampleUrl,
    sampleHeight: post.sampleHeight,
    sampleWidth: post.sampleWidth,
    previewUrl: post.previewUrl,
    previewHeight: post.previewHeight,
    previewWidth: post.previewWidth,

    tags: post.tags.join(" "),

    score: post.score,
    source: Array.isArray(post.source) ? post.source.join("\n") : post.source,
    rating: post.rating,

    createdAt:
      post.createdAt instanceof Date ? post.createdAt.toISOString() : null,
  };
}

function mapTagToInsert(tag: any): DBTag | null {
  if (!tag.tag_name || tag.tag_name.trim() === "") {
    return null;
  }
  return {
    id: tag.tag_id,
    name: tag.tag_name.trim(),
    post_count: tag.post_count ?? 0,
    category_id: tag.category_id ?? 6,
    is_ambiguous: tag.is_ambiguous ?? 0,
  };
}

export class GelbooruDB {
  private db: Sqlite3.Database;
  private statements: Map<string, Sqlite3.Statement>;

  constructor(dbPath: string) {
    const db = new Sqlite3(dbPath, {
      verbose: () => {},
    });
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    this.db = db;
    this.statements = new Map();
    this.createStatements();
  }

  private createStatements() {
    // Insert or replace a post
    const insertPost = this.db.prepare(`
      INSERT OR REPLACE INTO "posts" (
        id, height, width, available, fileUrl,
        sampleUrl, sampleHeight, sampleWidth,
        previewUrl, previewHeight, previewWidth,
        tags, score, source, rating, createdAt
      ) VALUES (
        @id, @height, @width, @available, @fileUrl,
        @sampleUrl, @sampleHeight, @sampleWidth,
        @previewUrl, @previewHeight, @previewWidth,
        @tags, @score, @source, @rating, @createdAt
      )
    `);

    // Insert or replace a tag
    const insertTag = this.db.prepare(`
      INSERT OR REPLACE INTO "tags" (
        id, name, post_count, category_id, is_ambiguous
      ) VALUES (
        @id, @name, @post_count, @category_id, @is_ambiguous
      )
    `);

    // Insert into the junction table
    const insertPostTag = this.db.prepare(`
      INSERT OR REPLACE INTO "post_tags" (post_id, tag_id)
      VALUES (@post_id, @tag_id)
    `);

    // Look up tag ID by name
    const getTagId = this.db.prepare(`
      SELECT id FROM "tags" WHERE name = @name
    `);

    const insertImageData = this.db.prepare<DBImageMeta>(`
		INSERT OR REPLACE INTO "images" (relative_folder, filename, post_id)
		VALUES (@relative_folder, @filename, @post_id)
	`);

    this.statements.set("post", insertPost);
    this.statements.set("tag", insertTag);
    this.statements.set("postTag", insertPostTag);
    this.statements.set("getTagId", getTagId);
    this.statements.set("setImageData", insertImageData);
  }

  public async *getPostsFromTag(
    tags: string[],
    rating?: "s" | "q" | "e" | "u" | "g",
  ): AsyncGenerator<{ posts: DBPost[]; offset: number }, void, unknown> {
    const tagsIntersect = tags
      .map(
        () =>
          `SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?)`,
      )
      .join("\nINTERSECT\n");
    const ratingSQL = rating ? `AND p.rating = ?` : "";

    let offset = 0;
    while (true) {
      const mainTemplate = `
		SELECT p.*
			FROM posts p
		WHERE p.id IN (
			${tagsIntersect}
		)
		${ratingSQL}
		ORDER BY p.createdAt DESC
		LIMIT 100 OFFSET ?;
		`;
      offset += 100;

      const params: (string | number)[] = [...tags];
      if (rating) {
        params.push(rating);
      }
      params.push(offset);

      const stmt = this.db.prepare(mainTemplate);
      const data = stmt.all(params) as DBPost[];
      if (data.length <= 0) {
        break;
      }
      yield { posts: data, offset: offset };
    }
  }

  public insertImageMeta(meta: DBImageMeta) {
    const setImageData: Statement<DBImageMeta, unknown> =
      this.statements.get("setImageData")!;

    setImageData.run(meta);
  }

  /** Insert a single post and its tag relationships */
  public insertPost(post: Post) {
    const postStmt = this.statements.get("post")!;
    const insertPostTag = this.statements.get("postTag")!;
    const getTagId = this.statements.get("getTagId")!;

    postStmt.run(mapPostToInsert(post));

    // insert each tag relationship
    for (const tagName of post.tags) {
      if (!tagName) continue;
      const result = getTagId.get({ name: tagName });
      if (result) {
        insertPostTag.run({
          post_id: post.id,
          tag_id: (result as any).id,
        });
      }
    }
  }

  /** Insert many posts in a transaction (faster) */
  public insertPosts(posts: Post[]) {
    const insertMany = this.db.transaction((posts: Post[]) => {
      for (const post of posts) {
        this.insertPost(post);
      }
    });
    insertMany(posts);
  }

  /** Insert a single tag (from JSONL dataset) */
  public insertTag(tag: any) {
    const data = mapTagToInsert(tag);
    if (!data) return; // skip empty or invalid
    const insertTag = this.statements.get("tag")!;
    insertTag.run(data);
  }

  /** Insert many tags in a transaction */
  public insertTags(tags: any[]) {
    const insertMany = this.db.transaction((tags: any[]) => {
      for (const tag of tags) {
        this.insertTag(tag);
      }
    });
    insertMany(tags);
  }

  /** Bulk import tags from a JSONL file (line‑by‑line) */
  public async importTagsFromFile(filePath: string) {
    console.log(`Importing tags from ${filePath}...`);
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const batchSize = 1000;
    let batch: any[] = [];
    let count = 0;

    for await (const line of rl) {
      try {
        const tag = JSON.parse(line);
        if (!tag.tag_name || tag.tag_name.trim() === "") continue;
        batch.push(tag);
        count++;

        if (batch.length >= batchSize) {
          this.insertTags(batch);
          console.log(`Imported ${count} tags...`);
          batch = [];
        }
      } catch (err) {
        console.error("Error parsing line:", err);
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      this.insertTags(batch);
    }

    console.log(`Imported ${count} tags from ${filePath}`);
  }

  /** Close the database connection */
  public close() {
    this.db.close();
  }
}
