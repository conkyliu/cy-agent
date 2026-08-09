import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * write_file 安全兜底：覆写前创建 git 快照。
 *
 * 采用 `git hash-object -w` 把原文件内容写入对象库（blob）：
 * 不触碰索引、工作区与提交历史，是侵入性最低的快照方式。
 * 恢复只需 `git cat-file blob <sha> > <path>`。
 *
 * 安全兜底原则：任何失败（非 git 仓库、git 缺失、哈希失败）都静默跳过，
 * 绝不阻塞写入本身。
 */

const execFileAsync = promisify(execFile);

const BLOB_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface GitSnapshotResult {
  /** 是否成功创建快照。 */
  created: boolean;
  /** 快照 blob 的 SHA-1（created 为 true 时存在）。 */
  blobSha?: string;
  /** 未创建时的原因，便于调试。 */
  reason?: string;
}

/**
 * 为指定文件创建 git 快照。
 * @param repoCwd 作为 git 仓库根的工作区目录（execFile 的 cwd）
 * @param file 目标文件的绝对路径
 */
export async function createGitSnapshot(repoCwd: string, file: string): Promise<GitSnapshotResult> {
  // 非 git 仓库或 git 不可用时静默跳过。
  // rev-parse 在仓库外以非零码退出（stderr 含 "not a git repository"），
  // 与 git 命令本身缺失（ENOENT）区分开。
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoCwd,
    });
    if (stdout.trim() !== 'true') {
      return { created: false, reason: 'not-a-git-repo' };
    }
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : '';
    if (stderr.includes('not a git repository')) {
      return { created: false, reason: 'not-a-git-repo' };
    }
    return { created: false, reason: 'git-unavailable' };
  }

  try {
    const { stdout } = await execFileAsync('git', ['hash-object', '-w', '--', file], {
      cwd: repoCwd,
    });
    const sha = stdout.trim();
    if (!BLOB_SHA_PATTERN.test(sha)) {
      return { created: false, reason: 'unexpected-hash-object-output' };
    }
    return { created: true, blobSha: sha };
  } catch {
    return { created: false, reason: 'hash-object-failed' };
  }
}
