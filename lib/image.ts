import * as fs from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";

import path from "node:path";
import { URL } from "node:url";

// grab from sqlite database instead of api

export async function downloadImage(url: string, init?: RequestInit) {
  const response = await fetch(url, init);

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
