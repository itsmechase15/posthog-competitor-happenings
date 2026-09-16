import type { Config } from "../config.js";
import { createLogger } from "../log.js";
import { githubRequest } from "./issue.js";

const log = createLogger("github-files");

/**
 * Committing a file to this repo and handing back a URL that renders it.
 *
 * GitHub Issues renders an image from a URL and nothing else: an attachment
 * needs a browser upload, and a body that says "open this link to see the
 * before/after" is the handoff the card exists to avoid. So a card's PNG is
 * committed to the repo that files the issues, and the issue embeds the raw
 * URL of the committed file.
 *
 * The file name carries a hash of the card, so a path always holds the same
 * bytes. That is what makes a branch-pinned raw URL safe to embed, makes a
 * re-render of an unchanged edit free, and makes a revised edit a new file
 * rather than an old URL quietly showing new copy.
 */

/** Where the cards live. Stable, so a raw URL keeps working. */
export const CARD_DIR = "artifacts/update-pages";

export const RAW_BASE = "https://raw.githubusercontent.com";

export interface FileStore {
  readonly description: string;
  /**
   * Commit `bytes` at `path` and return a URL that renders it, or null when
   * nothing could be written. Never throws: a card with no picture is the
   * fallback, and an unwritable file is not a reason to skip the issue.
   */
  put(path: string, bytes: Buffer, message: string): Promise<string | null>;
}

interface ContentsResponse {
  message?: string;
  content?: { path?: string };
}

interface RepoResponse {
  message?: string;
  default_branch?: string;
}

export class GitHubFileStore implements FileStore {
  readonly description: string;

  /** Looked up once per run, because a repo's default branch does not move. */
  private branch: string | undefined;

  constructor(
    private readonly repo: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {
    this.description = `commits cards to ${repo}/${CARD_DIR}`;
  }

  async put(path: string, bytes: Buffer, message: string): Promise<string | null> {
    try {
      const branch = await this.defaultBranch();
      const url = `${RAW_BASE}/${this.repo}/${branch}/${path}`;

      if (await this.exists(path, branch)) {
        log.debug(`${path} is already committed`);
        return url;
      }

      try {
        await githubRequest<ContentsResponse>({
          method: "PUT",
          path: `/repos/${this.repo}/contents/${path}`,
          token: this.token,
          timeoutMs: this.timeoutMs,
          payload: { message, content: bytes.toString("base64"), branch },
        });
      } catch (error) {
        // Two cards for the same edit in one run, or a retry of a run that got
        // as far as the commit: the path already holds these bytes, and the
        // URL is good either way.
        const conflict = error instanceof Error && /\b(409|422)\b/.test(error.message);
        if (!conflict) throw error;
        log.debug(`${path} was written by something else: ${(error as Error).message}`);
        return url;
      }

      log.info(`committed ${path}`);
      return url;
    } catch (error) {
      log.warn(
        `could not commit ${path}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  private async defaultBranch(): Promise<string> {
    if (this.branch !== undefined) return this.branch;
    try {
      const repo = await githubRequest<RepoResponse>({
        method: "GET",
        path: `/repos/${this.repo}`,
        token: this.token,
        timeoutMs: this.timeoutMs,
      });
      this.branch = repo.default_branch ?? "main";
    } catch (error) {
      log.debug(`could not read the default branch: ${error instanceof Error ? error.message : error}`);
      this.branch = "main";
    }
    return this.branch;
  }

  private async exists(path: string, branch: string): Promise<boolean> {
    try {
      await githubRequest<ContentsResponse>({
        method: "GET",
        path: `/repos/${this.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        token: this.token,
        timeoutMs: this.timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/** Used in a dry run and when there is no token. Writes nothing, says so. */
export class DisabledFileStore implements FileStore {
  readonly description: string;

  constructor(readonly reason: string) {
    this.description = `skipped (${reason})`;
  }

  async put(path: string, bytes: Buffer, _message: string): Promise<string | null> {
    log.info(`[${this.reason}] would commit ${path} (${bytes.length} bytes)`);
    return null;
  }
}

export function createFileStore(config: Config): FileStore {
  if (config.dryRun) return new DisabledFileStore("dry run");
  if (!config.githubToken) return new DisabledFileStore("GITHUB_TOKEN is not set");
  return new GitHubFileStore(config.githubRepo, config.githubToken, config.httpTimeoutMs);
}
