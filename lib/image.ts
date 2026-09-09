import * as fs from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";

import path from "node:path";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";

const execAsync = promisify(exec);

/** Returns the new relative path after conversion. */
export async function convertImage(
  root: string,
  absolutePath: string,
): Promise<string> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath, path.extname(absolutePath));
  const resultAbsolutePath = path.join(dir, `${base}.webp`);

  try {
    const { stdout, stderr } = await execAsync(
      `magick "${absolutePath}" -quality 80 "${resultAbsolutePath}"`,
    );

    if (stderr) {
      console.warn(`Conversion stderr: ${stderr}`);
    }

    await rm(absolutePath, { force: true });

    const relativePath = path.relative(root, resultAbsolutePath);
    console.log(`Converted: ${relativePath}`);
    return relativePath;
  } catch (error) {
    const originalRelative = path.relative(root, absolutePath);
    console.log(`Keeping original due to error above: ${originalRelative}`);
    return originalRelative;
  }
}

export async function downloadImage(
  url: string,
  filepath: string,
  init?: RequestInit,
) {
  const response = await fetch(url, init);

  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  if (!response.body) throw new Error("No response body found.");
  if (!url) throw new Error("No fileURL found.");

  const destination = fs.createWriteStream(filepath);
  const readableNodeStream = Readable.fromWeb(response.body as any);

  await finished(readableNodeStream.pipe(destination));
}

/**
 * Ensures the directory containing the given file path exists.
 * Returns the same path for easy chaining.
 */
export function ensureDirectoryExists(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolves a stored relative path to a full filesystem path
 * using the configured base directory.
 *
 * @param relativePath - The path stored in the DB (e.g., 'images/bf/97/file.jpg')
 * @param baseDir - The root directory (default: process.env.DOWNLOAD_BASE || process.cwd())
 */
export function resolveStoredPath(
  relativePath: string,
  baseDir?: string,
): string {
  const root = baseDir ?? process.cwd();
  return path.join(root, relativePath);
}

/**
 * Extracts the relative path from an HTTP/HTTPS URL.
 * This is the part that will be stored in the database.
 *
 * @example
 * // URL: https://img4.gelbooru.com/images/bf/97/0a8269...jpg
 * // Returns: 'images/bf/97/0a8269...jpg'
 */
export function getRelativePathFromUrl(urlString: string): string {
  const url = new URL(urlString);
  // Remove leading slash and any query/hash
  return url.pathname.replace(/^\//, "");
}
