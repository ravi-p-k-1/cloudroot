/**
 * archivist1 branch creation via GitHub's Git Data API: read main's tree,
 * check for a duplicate, then tree -> commit -> ref. See PLAN.md's
 * "Worker spec" section for the exact call sequence and response mapping.
 */

const GITHUB_API = "https://api.github.com";

export class DuplicateError extends Error {}
// Token missing, expired, or lacking permission on ARCHIVIST_REPO -> 500.
export class GithubAuthError extends Error {}
// Any other non-2xx or network failure talking to GitHub -> 502.
export class GithubApiError extends Error {}

async function githubRequest(env, path, options = {}) {
  let response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${env.ARCHIVIST_TOKEN}`,
        "User-Agent": "transcript-intake-worker",
        Accept: "application/vnd.github+json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (err) {
    throw new GithubApiError(`network error calling ${path}: ${err.message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new GithubAuthError(`${path} -> ${response.status}`);
  }
  return response;
}

// transcripts/<date>/ and archived/<date>/ must not exist on main, and no
// branch may match cloudflare/<date>*.
async function isDuplicate(env, date) {
  const [transcriptsRes, archivedRes, branchesRes] = await Promise.all([
    githubRequest(env, `/repos/${env.ARCHIVIST_REPO}/contents/transcripts/${date}`),
    githubRequest(env, `/repos/${env.ARCHIVIST_REPO}/contents/archived/${date}`),
    githubRequest(env, `/repos/${env.ARCHIVIST_REPO}/git/matching-refs/heads/cloudflare/${date}`),
  ]);

  if (transcriptsRes.status === 200 || archivedRes.status === 200) {
    return true;
  }
  if (branchesRes.ok) {
    const branches = await branchesRes.json();
    if (branches.length > 0) return true;
  }
  return false;
}

/**
 * Creates cloudflare/<date>-<hhmm> on archivist1, containing only
 * transcripts/<date>/meet/transcript.json on top of main. Throws
 * DuplicateError / GithubAuthError / GithubApiError on failure.
 */
export async function createTranscriptBranch(env, { date, hhmm, meetingJson }) {
  const repo = env.ARCHIVIST_REPO;

  const mainRef = await githubRequest(env, `/repos/${repo}/git/ref/heads/main`);
  if (!mainRef.ok) throw new GithubApiError(`reading main ref: ${mainRef.status}`);
  const mainSha = (await mainRef.json()).object.sha;

  const mainCommit = await githubRequest(env, `/repos/${repo}/git/commits/${mainSha}`);
  if (!mainCommit.ok) throw new GithubApiError(`reading main commit: ${mainCommit.status}`);
  const baseTreeSha = (await mainCommit.json()).tree.sha;

  if (await isDuplicate(env, date)) {
    throw new DuplicateError(`${date} already has a transcript or an in-flight branch`);
  }

  const path = `transcripts/${date}/meet/transcript.json`;
  const treeRes = await githubRequest(env, `/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [{ path, mode: "100644", type: "blob", content: meetingJson }],
    }),
  });
  if (!treeRes.ok) throw new GithubApiError(`creating tree: ${treeRes.status}`);
  const treeSha = (await treeRes.json()).sha;

  const commitRes = await githubRequest(env, `/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Add transcript for ${date}`,
      tree: treeSha,
      parents: [mainSha],
    }),
  });
  if (!commitRes.ok) throw new GithubApiError(`creating commit: ${commitRes.status}`);
  const commitSha = (await commitRes.json()).sha;

  const branch = `cloudflare/${date}-${hhmm}`;
  const refRes = await githubRequest(env, `/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
  });
  if (refRes.status === 422) {
    // Lost a race with another post for the same date+minute - treat the
    // same as the earlier duplicate check finding one.
    throw new DuplicateError(`${branch} already exists`);
  }
  if (!refRes.ok) throw new GithubApiError(`creating ref: ${refRes.status}`);

  return branch;
}
