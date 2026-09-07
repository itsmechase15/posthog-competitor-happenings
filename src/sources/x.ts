import type { CompetitorConfig } from "../config.js";
import type { CandidateItem } from "../types.js";
import { truncate } from "../util/text.js";

export interface XUser {
  id: string;
  username: string;
}

export interface XPost {
  id: string;
  text: string;
  created_at?: string;
}

export interface XUserResponse {
  data?: XUser;
  errors?: Array<{ detail?: string; title?: string }>;
}

export interface XTimelineResponse {
  data?: XPost[];
  errors?: Array<{ detail?: string; title?: string }>;
}

export const X_API_BASE = "https://api.x.com/2";

export function userLookupUrl(username: string): string {
  return `${X_API_BASE}/users/by/username/${encodeURIComponent(username)}`;
}

export function timelineUrl(userId: string, maxResults: number): string {
  const params = new URLSearchParams({
    max_results: String(Math.max(5, Math.min(100, maxResults))),
    "tweet.fields": "created_at,entities",
    exclude: "retweets,replies",
  });
  return `${X_API_BASE}/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`;
}

export function postsToItems(
  competitor: CompetitorConfig,
  posts: XPost[],
  username: string,
): CandidateItem[] {
  return posts.map((post) => ({
    competitor: competitor.id,
    source: "x" as const,
    externalId: post.id,
    title: truncate(post.text.replace(/\s+/g, " ").trim(), 120),
    url: `https://x.com/${username}/status/${post.id}`,
    publishedAt: post.created_at ? new Date(post.created_at) : null,
    raw: { username, text: post.text },
  }));
}
