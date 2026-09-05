import { BooruClass } from "booru";

type Subquery = {
  tags: string[];
  score: Score;
  rating: string;
};
type Score = {
  n: number;
  is_limit: boolean;
};

export function subqueryToTags(subquery: Subquery): string[] {
  if (subquery.score.is_limit) {
    return [...subquery.tags, `score:>=${subquery.score.n}`, subquery.rating];
  }
  return [...subquery.tags, `score:${subquery.score.n}`, subquery.rating];
}

// [ ====================================== ]

export async function createSubtagQueriesFromTags(
  gb: BooruClass,
  tags: string[],
  maxScore: number,
): Promise<Subquery[]> {
  const ratings = createRatingTags();
  const final: Subquery[] = [];

  for (const rating of ratings) {
    const { tailStart, exactScores } = await findOptimalScoreTail(
      gb,
      tags,
      rating,
      maxScore,
    );

    // Exact scores
    for (const score of exactScores) {
      final.push({
        tags,
        score: { n: score, is_limit: false },
        rating,
      });
    }

    // Tail: score:>=tailStart (if tailStart is within bounds)
    final.push({
      tags,
      score: { n: tailStart, is_limit: true },
      rating,
    });
  }

  return final;
}

async function findOptimalScoreTail(
  gb: BooruClass,
  baseTags: string[],
  rating: string,
  maxScore: number,
): Promise<{
  tailStart: number; // the N where score:>=N is under 10k
  exactScores: number[]; // scores 0..N-1 to query individually
}> {
  // Binary search for the lowest N where count(score:>=N) < 10_000
  let low = 0;
  let high = maxScore;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const tags = [...baseTags, rating, `score:>=${mid}`];

    const count = await retryWithBackoff(
      () => gb.getPostCount(tags),
      `getPostCount(${tags.join(",")})`,
    );

    if (count >= 10_000) {
      // Too broad, move N higher
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const tailStart = low;
  // Exact scores: 0..tailStart-1
  const exactScores = Array.from({ length: tailStart }, (_, i) => i);

  return { tailStart, exactScores };
}

function createRatingTags() {
  return ["g", "q", "e"].map((c) => "rating:" + c);
}
