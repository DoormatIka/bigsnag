import * as fs from "fs";
import { Readable } from "stream";
import { finished } from "stream/promises";

import path from "node:path";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";

const execAsync = promisify(exec);

function shellParser(cmd: string, input: string, output: string) {
  return cmd.replace("$<input>", input).replace("$<output>", output);
}

export async function convertAny(
  root: string,
  absolutePath: string,
): Promise<string> {
  const extname = path.extname(absolutePath);
  const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".wmv"].includes(
    extname,
  );
  const isImage = [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".jfif",
    ".avif",
    ".bmp",
    ".tif",
    ".tiff",
  ].includes(extname);
  if (isVideo) {
    const templateCommand = `magick "$<input>" -quality 80 "$<output>.webp"`;
    return convertTemplate(root, absolutePath, templateCommand);
  } else if (isImage) {
    const templateCommand = `ffmpeg -i "$<input>" -c:v libx265 -crf 32 -c:a copy "$<output>.mp4"`;
    return convertTemplate(root, absolutePath, templateCommand);
  } else {
    const originalRelative = path.relative(root, absolutePath);
    console.log(
      `Keeping original due to unsupported file type: ${originalRelative}`,
    );
    return originalRelative;
  }
}

/** Returns the new relative path after conversion. */
export async function convertTemplate(
  root: string,
  absolutePath: string,
  templateCommand: string,
): Promise<string> {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath, path.extname(absolutePath));
  const resultAbsolutePath = path.join(dir, base);

  const cmd = shellParser(templateCommand, absolutePath, resultAbsolutePath);

  try {
    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) {
      console.warn(`Conversion stderr: ${stderr}`);
    }

    await rm(absolutePath, { force: true });

    const relativePath = path.relative(root, resultAbsolutePath);
    console.log(`Converted: ${relativePath}`);
    return relativePath;
  } catch (error) {
    const originalRelative = path.relative(root, absolutePath);
    console.log(`Keeping original due to error: ${originalRelative}\n${error}`);
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
