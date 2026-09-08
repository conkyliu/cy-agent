import { describe, expect, it } from 'vitest';
import { isSafeCommand } from '../src/safe-commands.js';

describe('isSafeCommand', () => {
  it('识别安全的独立只读命令', () => {
    expect(isSafeCommand('pwd')).toBe(true);
    expect(isSafeCommand('ls')).toBe(true);
    expect(isSafeCommand('ls -la src/')).toBe(true);
    expect(isSafeCommand('cat package.json')).toBe(true);
    expect(isSafeCommand('head -n 20 README.md')).toBe(true);
    expect(isSafeCommand('tail -f log.txt')).toBe(true);
    expect(isSafeCommand('wc -l src/index.ts')).toBe(true);
    expect(isSafeCommand('which node')).toBe(true);
    expect(isSafeCommand('echo "hello world"')).toBe(true);
    expect(isSafeCommand('uname -a')).toBe(true);
  });

  it('识别版本查询命令', () => {
    expect(isSafeCommand('node -v')).toBe(true);
    expect(isSafeCommand('node --version')).toBe(true);
    expect(isSafeCommand('pnpm -v')).toBe(true);
    expect(isSafeCommand('npm --version')).toBe(true);
    expect(isSafeCommand('git --version')).toBe(true);
  });

  it('识别 Git 只读子命令', () => {
    expect(isSafeCommand('git status')).toBe(true);
    expect(isSafeCommand('git status -s')).toBe(true);
    expect(isSafeCommand('git diff')).toBe(true);
    expect(isSafeCommand('git diff HEAD~1')).toBe(true);
    expect(isSafeCommand('git log -n 5 --oneline')).toBe(true);
    expect(isSafeCommand('git branch -a')).toBe(true);
    expect(isSafeCommand('git show HEAD')).toBe(true);
    expect(isSafeCommand('git rev-parse --show-toplevel')).toBe(true);
    expect(isSafeCommand('git remote -v')).toBe(true);
  });

  it('拒绝 Git 写操作子命令', () => {
    expect(isSafeCommand('git commit -m "feat"')).toBe(false);
    expect(isSafeCommand('git push origin main')).toBe(false);
    expect(isSafeCommand('git pull')).toBe(false);
    expect(isSafeCommand('git checkout -b feature')).toBe(false);
    expect(isSafeCommand('git reset --hard HEAD')).toBe(false);
    expect(isSafeCommand('git clean -fd')).toBe(false);
    expect(isSafeCommand('git rm -rf file.txt')).toBe(false);
    expect(isSafeCommand('git merge feature')).toBe(false);
    expect(isSafeCommand('git rebase main')).toBe(false);
  });

  it('严格拒绝包含危险重定向、管道与命令串联的请求', () => {
    expect(isSafeCommand('git status > out.txt')).toBe(false);
    expect(isSafeCommand('ls >> list.txt')).toBe(false);
    expect(isSafeCommand('cat file.txt | grep foo')).toBe(false);
    expect(isSafeCommand('echo "hi" | bash')).toBe(false);
    expect(isSafeCommand('pwd; rm -rf /')).toBe(false);
    expect(isSafeCommand('ls && echo "done"')).toBe(false);
    expect(isSafeCommand('ls || echo "failed"')).toBe(false);
    expect(isSafeCommand('echo $(whoami)')).toBe(false);
    expect(isSafeCommand('echo `whoami`')).toBe(false);
    expect(isSafeCommand('sudo ls')).toBe(false);
    expect(isSafeCommand('chmod +x script.sh')).toBe(false);
  });

  it('处理空串与非字符串边界', () => {
    expect(isSafeCommand('')).toBe(false);
    expect(isSafeCommand('   ')).toBe(false);
    // @ts-expect-error 测试非字符串入参
    expect(isSafeCommand(null)).toBe(false);
    // @ts-expect-error 测试未闭合引号
    expect(isSafeCommand('echo "unclosed')).toBe(false);
  });
});
