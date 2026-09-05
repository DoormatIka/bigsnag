import fs from "fs";
import readline from "readline";

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
