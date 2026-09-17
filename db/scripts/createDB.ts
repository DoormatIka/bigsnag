import { Client } from "pg";

/*

PGUSER=dbuser \
PGPASSWORD=secretpassword \
PGHOST=database.server.com \
PGPORT=3211 \
PGDATABASE=mydb \

in .env
*/

const client = await new Client().connect();

await client.query(`
CREATE TABLE public.posts (
  id text NOT NULL,
  height bigint NULL,
  width bigint NULL,
  available boolean NOT NULL DEFAULT false,
  file_url text NULL,
  sample_url text NULL,
  sample_height bigint NULL,
  sample_width bigint NULL,
  preview_url text NULL,
  preview_height bigint NULL,
  preview_width bigint NULL,
  tags text NULL,
  score bigint NULL,
  source text NULL,
  rating text NULL,
  created_at timestamptz NULL
);

ALTER TABLE public.posts
ADD CONSTRAINT idx_16779_sqlite_autoindex_posts_1 PRIMARY KEY (id);
`);
await client.query(`
CREATE TABLE public.tags (
  id bigint NOT NULL,
  name text NOT NULL,
  post_count bigint NOT NULL DEFAULT '0'::bigint,
  category_id bigint NOT NULL DEFAULT '6'::bigint,
  is_ambiguous boolean NOT NULL DEFAULT false
);

ALTER TABLE public.tags
ADD CONSTRAINT idx_16766_sqlite_autoindex_tags_1 PRIMARY KEY (id);
`);
await client.query(`
CREATE TABLE public.post_tags (post_id text NOT NULL, tag_id bigint NOT NULL);

ALTER TABLE public.post_tags
ADD CONSTRAINT idx_16774_sqlite_autoindex_post_tags_1 PRIMARY KEY (post_id, tag_id);
`);
await client.query(`
CREATE TABLE public.images (
  post_id text NOT NULL,
  relative_folder text NOT NULL,
  filename text NOT NULL
);

ALTER TABLE public.images
ADD CONSTRAINT idx_16784_sqlite_autoindex_images_1 PRIMARY KEY (post_id);

ALTER TABLE public.post_tags
  ADD CONSTRAINT post_tags_post_fk FOREIGN KEY (post_id)
    REFERENCES posts(id) ON DELETE CASCADE,
  ADD CONSTRAINT post_tags_tag_fk  FOREIGN KEY (tag_id)
    REFERENCES tags(id)  ON DELETE CASCADE;

ALTER TABLE public.images
  ADD CONSTRAINT images_post_fk FOREIGN KEY (post_id)
    REFERENCES posts(id) ON DELETE CASCADE;

ALTER DATABASE gelboorudb SET timezone TO 'UTC';
`);
