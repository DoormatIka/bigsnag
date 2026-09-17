import { Pool, type PoolConfig } from "pg";
import { Post } from "booru";
import * as fs from "fs";
import * as readline from "readline";

export type DBPost = {
  id: string;
  height: number;
  width: number;
  available: boolean;
  file_url: string | null;
  sample_url: string | null;
  sample_height: number | null;
  sample_width: number | null;
  preview_url: string | null;
  preview_height: number | null;
  preview_width: number | null;
  tags: string;
  score: number;
  source: string | undefined;
  rating: string;
  created_at: string | null;
};

export type DBTag = {
  id: number;
  name: string;
  post_count: number;
  category_id: number;
  is_ambiguous: boolean;
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
    available: post.available ?? false,
    file_url: post.fileUrl,
    sample_url: post.sampleUrl,
    sample_height: post.sampleHeight,
    sample_width: post.sampleWidth,
    preview_url: post.previewUrl,
    preview_height: post.previewHeight,
    preview_width: post.previewWidth,
    tags: post.tags.join(" "),
    score: post.score,
    source: Array.isArray(post.source) ? post.source!.join("\n") : post.source,
    rating: post.rating,
    created_at:
      post.createdAt instanceof Date ? post.createdAt.toISOString() : null,
  };
}

function mapTagToInsert(tag: any): DBTag | null {
  if (!tag.tag_name || tag.tag_name.trim() === "") return null;
  return {
    id: tag.tag_id,
    name: tag.tag_name.trim(),
    post_count: tag.post_count ?? 0,
    category_id: tag.category_id ?? 6,
    is_ambiguous: tag.is_ambiguous ?? false,
  };
}

export class GelbooruDB {
  private pool: Pool;

  constructor(config?: string | PoolConfig) {
    if (typeof config === "string") {
      this.pool = new Pool({ connectionString: config });
    } else if (config) {
      this.pool = new Pool(config);
    } else {
      // No args > pg reads PGHOST, PGUSER, PGPASSWORD,
      // 			PGDATABASE, PGPORT, PGSSLMODE from process.env
      this.pool = new Pool();
    }
  }

  public async *getPostsFromTag(
    tags: string[],
    rating?: "s" | "q" | "e" | "u" | "g",
  ): AsyncGenerator<{ posts: DBPost[]; offset: number }, void, unknown> {
    console.log("getPostsFromTag called with:", tags, "rating:", rating);
    if (tags.length === 0) {
      return;
    }

    const tagsIntersect = tags
      .map(
        (_, i) =>
          `SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = $${i + 1})`,
      )
      .join("\nINTERSECT\n");
    let nextParam = tags.length + 1;
    const ratingSQL = rating ? `AND p.rating = $${nextParam++}` : "";
    const offsetParam = nextParam;

    let offset = 0;
    const limit = 100;

    const mainTemplate = `
		SELECT p.*
			FROM posts p
		WHERE p.id IN (
			${tagsIntersect}
		)
		${ratingSQL}
		ORDER BY p.created_at DESC
		LIMIT ${limit} OFFSET $${offsetParam};
	`;

    while (true) {
      const params: (string | number)[] = [...tags];
      if (rating) {
        params.push(rating);
      }
      params.push(offset);

      const result = await this.pool.query<DBPost>(mainTemplate, params);
      if (result.rows.length === 0) break;

      yield { posts: result.rows, offset: offset };
      offset += limit;
    }
  }

  public async insertImageMeta(meta: DBImageMeta) {
    await this.pool.query(
      `INSERT INTO images (post_id, relative_folder, filename)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_id) DO UPDATE
         SET relative_folder = EXCLUDED.relative_folder,
             filename        = EXCLUDED.filename`,
      [meta.post_id, meta.relative_folder, meta.filename],
    );
  }

  /** Insert a single post and its tag relationships */
  public async insertPost(post: Post) {
    const d = mapPostToInsert(post);

    await this.pool.query(
      `INSERT INTO posts (
         id, height, width, available, file_url,
         sample_url, sample_height, sample_width,
         preview_url, preview_height, preview_width,
         tags, score, source, rating, created_at
       ) VALUES (
         $1,  $2,  $3,  $4,  $5,
         $6,  $7,  $8,
         $9,  $10, $11,
         $12, $13, $14, $15, $16
       )
       ON CONFLICT (id) DO UPDATE SET
         height         = EXCLUDED.height,
         width          = EXCLUDED.width,
         available      = EXCLUDED.available,
         file_url       = EXCLUDED.file_url,
         sample_url     = EXCLUDED.sample_url,
         sample_height  = EXCLUDED.sample_height,
         sample_width   = EXCLUDED.sample_width,
         preview_url    = EXCLUDED.preview_url,
         preview_height = EXCLUDED.preview_height,
         preview_width  = EXCLUDED.preview_width,
         tags           = EXCLUDED.tags,
         score          = EXCLUDED.score,
         source         = EXCLUDED.source,
         rating         = EXCLUDED.rating,
         created_at     = EXCLUDED.created_at`,
      [
        d.id,
        d.height,
        d.width,
        d.available,
        d.file_url,
        d.sample_url,
        d.sample_height,
        d.sample_width,
        d.preview_url,
        d.preview_height,
        d.preview_width,
        d.tags,
        d.score,
        d.source,
        d.rating,
        d.created_at,
      ],
    );

    const tagNames = post.tags.filter((t): t is string => !!t);
    if (tagNames.length > 0) {
      await this.pool.query(
        `INSERT INTO post_tags (post_id, tag_id)
         SELECT $1, t.id
           FROM tags t
          WHERE t.name = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [post.id, tagNames],
      );
    }
  }

  /** Insert many posts in a transaction (faster) */
  public async insertPosts(posts: Post[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const post of posts) await this.insertPost(post);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Insert a single tag (from JSONL dataset) */
  public async insertTag(tag: any) {
    const data = mapTagToInsert(tag);
    if (!data) return;

    await this.pool.query(
      `INSERT INTO tags (id, name, post_count, category_id, is_ambiguous)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name         = EXCLUDED.name,
         post_count   = EXCLUDED.post_count,
         category_id  = EXCLUDED.category_id,
         is_ambiguous = EXCLUDED.is_ambiguous`,
      [
        data.id,
        data.name,
        data.post_count,
        data.category_id,
        data.is_ambiguous,
      ],
    );
  }

  /** Insert many tags in a transaction */
  public async insertTags(tags: any[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const tag of tags) await this.insertTag(tag);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
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
          await this.insertTags(batch);
          console.log(`Imported ${count} tags...`);
          batch = [];
        }
      } catch (err) {
        console.error("Error parsing line:", err);
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await this.insertTags(batch);
    }

    console.log(`Imported ${count} tags from ${filePath}`);
  }

  /** Close the database connection */
  public async close() {
    await this.pool.end();
  }
}
