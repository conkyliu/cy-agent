import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSkillsOverviewSection,
  createLoadSkillTool,
  listSkills,
  loadExtensions,
  loadPluginTools,
  readSkill,
} from '../src/index.js';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cy-ext-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

async function writeSkill(name: string, content: string): Promise<void> {
  await fs.mkdir(path.join(workspace, '.cy-agent', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.cy-agent', 'skills', `${name}.md`), content, 'utf8');
}

describe('skills', () => {
  it('列出技能：名称取文件名，描述取首个非空行（去标题符）', async () => {
    await writeSkill('commit-flow', '# 规范提交信息\n\n按约定式提交格式撰写。');
    const skills = await listSkills(workspace);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('commit-flow');
    expect(skills[0]?.description).toBe('规范提交信息');
  });

  it('readSkill 返回技能全文', async () => {
    await writeSkill('demo', '步骤一\n步骤二');
    const content = await readSkill(workspace, 'demo');
    expect(content).toContain('步骤一');
    expect(content).toContain('步骤二');
  });

  it('readSkill 拒绝含路径穿越的名称', async () => {
    await writeSkill('demo', 'body');
    await expect(readSkill(workspace, '../etc/passwd')).rejects.toThrow('Invalid skill name');
    await expect(readSkill(workspace, 'a/b')).rejects.toThrow('Invalid skill name');
  });

  it('load_skill 工具往返；未知技能返回可用清单', async () => {
    await writeSkill('demo', 'the body');
    const tool = createLoadSkillTool(workspace);
    expect(tool.requiresApproval).toBeFalsy();
    expect(await tool.execute({ name: 'demo' })).toBe('the body');
    const missing = await tool.execute({ name: 'ghost' });
    expect(missing).toContain('not found');
    expect(missing).toContain('demo');
  });

  it('概览技能段：无技能为空，有技能含名称与 load_skill 提示', () => {
    expect(buildSkillsOverviewSection([])).toBe('');
    const section = buildSkillsOverviewSection([{ name: 'demo', description: 'desc' }]);
    expect(section).toContain('demo: desc');
    expect(section).toContain('load_skill');
  });
});

describe('plugins', () => {
  async function writePlugin(name: string, content: string): Promise<void> {
    await fs.mkdir(path.join(workspace, '.cy-agent', 'plugins'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.cy-agent', 'plugins', name), content, 'utf8');
  }

  it('无插件目录返回空且不告警', async () => {
    const result = await loadPluginTools(workspace);
    expect(result.tools).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('合法插件注册成功并能执行', async () => {
    await writePlugin(
      'hello.mjs',
      `export default function createTools({ workspace }) {
        return [{
          name: 'plugin_hello',
          description: 'Say hello',
          parameters: { type: 'object', properties: {} },
          execute: async () => \`hello:\${workspace}\`,
        }];
      }`,
    );
    const result = await loadPluginTools(workspace);
    expect(result.warnings).toHaveLength(0);
    const tool = result.tools.find((item) => item.name === 'plugin_hello');
    expect(tool).toBeDefined();
    expect(await tool?.execute({})).toBe(`hello:${workspace}`);
  });

  it('坏插件降级告警，不影响其他插件', async () => {
    await writePlugin('broken.mjs', `export default 'not-a-function';`);
    await writePlugin(
      'good.mjs',
      `export default () => [{ name: 'good_tool', description: 'ok', parameters: {}, execute: async () => 'ok' }];`,
    );
    const result = await loadPluginTools(workspace);
    expect(result.tools.map((item) => item.name)).toContain('good_tool');
    expect(result.warnings.some((warning) => warning.includes('broken.mjs'))).toBe(true);
  });
});

describe('loadExtensions', () => {
  it('聚合插件工具与技能段，未配置 MCP 时跳过', async () => {
    await fs.mkdir(path.join(workspace, '.cy-agent', 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, '.cy-agent', 'plugins', 'p.mjs'),
      `export default () => [{ name: 'ext_tool', description: 'd', parameters: {}, execute: async () => 'x' }];`,
      'utf8',
    );
    await writeSkill('guide', 'do this');

    const extensions = await loadExtensions(workspace);
    expect(extensions.tools.map((item) => item.name)).toContain('ext_tool');
    expect(extensions.skills.map((skill) => skill.name)).toContain('guide');
    expect(extensions.skillsSection).toContain('guide');
    expect(extensions.mcpServers).toHaveLength(0);
  });

  it('无效 MCP 配置降级为告警，不抛错', async () => {
    const badConfig = path.join(workspace, 'mcp.json');
    await fs.writeFile(badConfig, JSON.stringify({ nope: true }), 'utf8');
    const extensions = await loadExtensions(workspace, { mcpConfig: badConfig });
    expect(extensions.warnings.some((warning) => warning.includes('not loaded'))).toBe(true);
    expect(extensions.tools).toHaveLength(0);
  });
});

describe('loadExtensions 符号索引', () => {
  it('有源码时注册导航工具并返回 symbolIndex', async () => {
    await fs.writeFile(path.join(workspace, 'app.ts'), 'export class App {}', 'utf8');
    const extensions = await loadExtensions(workspace);
    const names = extensions.tools.map((item) => item.name);
    expect(names).toContain('find_symbol');
    expect(names).toContain('file_dependencies');
    expect(extensions.symbolIndex.entries.map((entry) => entry.name)).toContain('App');
  });

  it('无源码工作区不注册导航工具', async () => {
    await fs.writeFile(path.join(workspace, 'readme.txt'), 'hi', 'utf8');
    const extensions = await loadExtensions(workspace);
    const names = extensions.tools.map((item) => item.name);
    expect(names).not.toContain('find_symbol');
    expect(names).not.toContain('file_dependencies');
    expect(extensions.symbolIndex.entries).toHaveLength(0);
  });
});
