import * as fs from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";

import path from "node:path";
import { URL } from "node:url";

import type { DBPost } from "./db.ts";

// grab from sqlite database instead of api

export async function downloadImage(url: string) {
  const response = await fetch(url, {});

  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  if (!response.body) throw new Error("No response body found.");
  if (!url) throw new Error("No fileURL found.");

  const outputPath = getOutputPath(url);
  const destination = fs.createWriteStream(outputPath);
  const readableNodeStream = Readable.fromWeb(response.body as any);

  await finished(readableNodeStream.pipe(destination));
}

function getOutputPath(fileUrl: string): string {
  const url = new URL(fileUrl);
  const p = path.parse(url.pathname);

  const dir = `.${p.dir}`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return `${dir}/${p.base}`;
}

await downloadImage(
  "https://img4.gelbooru.com/images/6c/bb/6cbb794e7df9a149f61f81453c5c5fed.jpeg",
);
