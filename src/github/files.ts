import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config.js";
import { createLogger } from "../log.js";
import { SPACED_EN_DASH } from "../util/text.js";
import { githubRequest } from "./issue.js";

const log = createLogger("github-files");

/**
 * Committing a file to this repo and handing back a URL that renders it.
 *
 * GitHub Issues renders an image from a URL and nothing else: an attachment
 * needs a browser upload, and a body that says "open this link to see the
 * before/after" is the handoff the pictures exist to avoid. So each screenshot
 * is committed to the repo that files the issues, and the issue embeds the raw
 * URL of the committed file. This repo is public, so a `raw.githubusercontent`
 * address renders for everybody who opens the issue, with no token in it and
 * nothing to expire.
 *
 * The file name carries a hash of the edit and the day it was taken, so a path
 * always holds the same bytes. That is what makes a branch-pinned raw URL safe
 * to embed, makes a second run the same morning free, and makes a revised edit
 * a new file rather than an old URL quietly showing new copy.
 *
 * The same store commits the pictures of a `consider_publishing` draft, under
 * `artifacts/consider-publishing/`, for the same reason.
 */

/** Where the page before/after screenshots live. Stable, so a raw URL keeps working. */
export const VISUAL_DIR = "artifacts/update-pages";

/** Everything this store writes sits under here. */
export const ARTIFACTS_DIR = "artifacts";

export const RAW_BASE = "https://raw.githubusercontent.com";

export interface FileStore {
  readonly description: string;
  /**
   * Commit `bytes` at `path` and return a URL that renders it, or null when
   * nothing could be written. Never throws: an issue with no pictures is the
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
    this.description = `commits screenshots to ${repo}/${ARTIFACTS_DIR}`;
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
        // Two pairs for the same edit in one run, or a retry of a run that got
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

/**
 * Used in a dry run and when there is no token. Commits nothing, and writes
 * each file to a temp directory so a dry run can be looked at.
 *
 * One directory for the whole run, so a before shot and its after land
 * together and flipping between them is opening two files in one folder.
 */
export class DisabledFileStore implements FileStore {
  readonly description: string;

  private directory: Promise<string> | null = null;

  constructor(readonly reason: string) {
    this.description = `writes to a temp directory (${reason})`;
  }

  async put(path: string, bytes: Buffer, _message: string): Promise<string | null> {
    try {
      this.directory ??= mkdtemp(join(tmpdir(), "update-pages-"));
      const file = join(await this.directory, path.split("/").pop() ?? "before-after.png");
      await writeFile(file, bytes);
      log.info(`[${this.reason}] would commit ${path}${SPACED_EN_DASH}wrote it to ${file} instead`);
    } catch (error) {
      log.info(
        `[${this.reason}] would commit ${path} (${bytes.length} bytes), and could not write it locally either: ${error instanceof Error ? error.message : error}`,
      );
    }
    // Null either way. A temp file is not an address an issue can embed, and
    // the whole point of a dry run is that nothing reaches an issue.
    return null;
  }
}

export function createFileStore(config: Config): FileStore {
  if (config.dryRun) return new DisabledFileStore("dry run");
  if (!config.githubToken) return new DisabledFileStore("GITHUB_TOKEN is not set");
  return new GitHubFileStore(config.githubRepo, config.githubToken, config.httpTimeoutMs);
}
