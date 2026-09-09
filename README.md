# bigsnag

A CLI tool to fetch posts and images from Gelbooru, store metadata in an SQLite database, and optionally download images (with conversion to .webp).

A pet project to handle the data I get from gelbooru using SQLite. Mostly to satiate my need to find good artists.

Data: [Most Beloved Artists](https://docs.google.com/spreadsheets/d/1WVOJpz08FAMBDzQMt34HxBXjolOjNf-1RedoKru_GiA/edit?gid=0#gid=0)

## features

- Smart pagination - bypass Gelbooru's 10,000 post API limit by splitting queries across score and rating.
- SQLite storage - stores all metadata (posts and tags) in a local database, useful for making more complicated queries than possible!
- Image download - downloads the original image files and stores them locally.
- Image conversion - optionally convert downloaded images to .webp.
- Test mode - preview how many posts a query would fetch without actually downloading.

## installation

```
git clone https://github.com/DoormatIka/bigsnag
cd bigsnag
npm install
```

Install ImageMagick as well for image compression!

Set your Gelbooru API credentials in an `.env` file:

```
GELBOORU_API_KEY=your_api_key
GELBOORU_USER_ID=your_user_id
```

To get these, log in to Gelbooru and look under your account settings.

## usage

```
npm run start -- [options]
```

- `--tags [string[]]` - One or more tags to search for.
  Use spaces for multi‑word tags: --tags="touhou" --tags="huge_breasts" or --tags="touhou huge_breasts"
- `--tagPath [string]` - Path to a text file containing one tag-query per line. Overrides `--tags`.
- `--importTagFile [string]` - If provided, imports tags from the Gelbooru tag dump (JSONL) located under (location)/resources/(file). Used once to seed the database.
- `--location [string=./]` - Base directory for the database file and image storage.
- `--downloadPosts [boolean=false]` - Fetch posts that match the tags and insert them into the database.
- `--downloadImages [boolean=false]` - Download the images for all posts in the database that don't already have a corresponding file.
- `--downloadPageCount [number=Infinity]` - Limit the number of pages (each 100 posts) to fetch/download per tag query.
- `--timeoutMs [number=5000]` - Delay in milliseconds between API requests to avoid rate limiting (and to be respectful).
- `--testTags [boolean=false]` - Only check the post count for each tag query, does not download anything.
- `--bypassLimit [boolean=false]` - Split the search into multiple sub-queries by score and rating to fetch more than 10,000 posts per tag.
  Extremely useful for downloading massive tags (touhou), however it multiplies the API requests significantly. Use with caution.
- `--scoreLimit [number=20]` - Used with `--bypassLimit` to limit the maximum score value to split exactly.

### examples

Download posts (metadata only) for a tag

```
npm run start -- --tags="touhou" --downloadPosts
```

Download posts from a large tag

```
npm run start -- --tags="huge_breasts" --bypassLimit --downloadPosts
```

Limit to 2 pages (200 posts) per tag query

```
npm run start -- --tags="touhou" --downloadPageCount=2 --downloadPosts
```

Importing the tag database (use one-time)

```
npm run start -- --importTagFile="gelbooru_tags_2026-06-11.jsonl"
```

### notes

I try not to overwhelm the servers with this project.
The defaults are way below the 5 request/second limit they put up, I suggest you be patient and wait instead.
Gelbooru is a small website.
