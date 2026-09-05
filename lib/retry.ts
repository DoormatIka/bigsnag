import { setTimeout } from "node:timers/promises";

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries = 5,
  baseDelay = 2000,
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries - 1) throw err;

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `\t- Retry ${attempt + 1}/${maxRetries} for ${context} in ${delay}ms`,
      );
      await setTimeout(delay);
    }
  }
  throw new Error(`Unreachable: retries exhausted for ${context}`);
}
