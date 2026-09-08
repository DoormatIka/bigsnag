-- CATEGORIES
-- 0=general, 1=artist, 2=circle, 3=copyright,
-- 4=character, 5=meta, 6=invalid

SELECT p.*
FROM posts p
WHERE p.rating = 'e'
 AND p.id IN (
    SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'touhou')
    INTERSECT
    SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'huge_breasts')
	INTERSECT
	SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'sweat')
  )
ORDER BY p.createdAt DESC
LIMIT 100 OFFSET 100; -- pagination!

SELECT COUNT(*) AS total
FROM posts p
WHERE p.rating = 'q' AND p.id IN (
    SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'touhou')
    INTERSECT
    SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'huge_breasts')
	INTERSECT
	SELECT post_id FROM post_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'sweat')
);

-- combine post and image record together
SELECT p.*, i.*
FROM posts p
JOIN images i ON i.post_id = p.id
WHERE p.id = 14700913;

-- grab image meta from post
SELECT * FROM images WHERE post_id = 14700913;

SELECT COUNT(*) AS count
FROM (
  SELECT p.id
  FROM posts p
  JOIN post_tags pt ON p.id = pt.post_id
  JOIN tags t ON pt.tag_id = t.id
  WHERE t.name IN ('genshin_impact')
  GROUP BY p.id
  HAVING COUNT(DISTINCT t.id) = 1
);

SELECT t.name, COUNT(*) AS post_count -- grabbing all most popular [category] items from tags.
FROM tags t
JOIN post_tags pt ON t.id = pt.tag_id
JOIN (
  SELECT pt2.post_id
  FROM post_tags pt2
  JOIN tags t2 ON pt2.tag_id = t2.id
  WHERE t2.name IN ('touhou', 'loli')  -- list required tags
  GROUP BY pt2.post_id
  HAVING COUNT(DISTINCT t2.id) = 2     -- number of required tags
) AS required_posts ON pt.post_id = required_posts.post_id
WHERE t.category_id = 1
GROUP BY t.id
ORDER BY COUNT(*) DESC
LIMIT 100;

WITH required_posts AS ( -- sort them by artist
  SELECT pt2.post_id
  FROM post_tags pt2
  JOIN tags t2 ON pt2.tag_id = t2.id
  WHERE t2.name IN ('touhou')    -- or IN ('touhou', 'huge_breasts') for multiple
  GROUP BY pt2.post_id
  HAVING COUNT(DISTINCT t2.id) = 1   -- only if you use multiple tags
)
SELECT
  t.name AS artist,
  COUNT(*) AS post_count,
  SUM(p.score) AS total_score,           -- sum of all posts' scores
  AVG(p.score) AS avg_score              -- average score per post (optional)
FROM tags t
JOIN post_tags pt ON t.id = pt.tag_id
JOIN required_posts rp ON pt.post_id = rp.post_id
JOIN posts p ON pt.post_id = p.id        -- need the posts table for scores
WHERE t.category_id = 1                  -- artist tags only
  AND p.rating = 'e'
GROUP BY t.id
ORDER BY post_count DESC                -- or avg_score DESC
LIMIT 100;

SELECT -- [costly] get all available tags in the posts with a category filter
  t.name,
  t.category_id,
  COUNT(*) AS post_count
FROM post_tags pt
JOIN tags t ON pt.tag_id = t.id
WHERE t.category_id = 0
GROUP BY t.id
ORDER BY post_count DESC
LIMIT 20;

SELECT COUNT(*) as post_count
FROM post_tags pt
JOIN tags t ON pt.tag_id = t.id
WHERE t.name = 'kenken28937178'  -- replace with artist name
AND t.category_id = 1; -- artist category

-- for filtering by category and sorting by post_count
CREATE INDEX idx_tags_category_post_count ON tags(category_id, post_count DESC);

-- for exact tag name lookups
CREATE INDEX idx_tags_name ON tags(name);

-- for post_tags table, an index on tag_id for lookups
CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);

-- for filtering artists quickly
CREATE INDEX IF NOT EXISTS idx_tags_category_id ON tags(category_id);

CREATE INDEX idx_post_tags_tag_id_post_id ON post_tags(tag_id, post_id);

PRAGMA optimize;
ANALYZE;