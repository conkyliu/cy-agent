import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolContract } from '@cy-agent/agent';

/** 技能定义目录（工作区内）。 */
export const SKILLS_DIR = '.cy-agent/skills';
/** 单个技能文件最大字节数，超限截断（防止异常大文件撑爆上下文）。 */
const MAX_SKILL_BYTES = 64 * 1024;

export interface SkillInfo {
  /** 技能名：文件名去 .md 扩展名。 */
  name: string;
  /** 描述：文件首个非空行（去标题符号）。 */
  description: string;
}

export interface LoadSkillArgs {
  name: string;
}

/** 技能名仅允许字母数字、下划线与连字符（防路径穿越）。 */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 扫描工作区技能清单；目录不存在或不可读时返回空（静默降级）。 */
export async function listSkills(workspace: string): Promise<SkillInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(workspace, SKILLS_DIR));
  } catch {
    return [];
  }
  const skills: SkillInfo[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.md')) {
      continue;
    }
    const skillName = name.slice(0, -3);
    try {
      const raw = await fs.readFile(path.join(workspace, SKILLS_DIR, name), 'utf8');
      skills.push({ name: skillName, description: firstDescription(raw) });
    } catch {
      // 单文件不可读跳过，不影响其余技能。
    }
  }
  return skills;
}

/** 取回技能全文；非法名称抛错（由 load_skill 转为错误文本交还模型）。 */
export async function readSkill(workspace: string, name: string): Promise<string> {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid skill name "${name}". Expected letters, digits, "-" or "_".`);
  }
  const raw = await fs.readFile(path.join(workspace, SKILLS_DIR, `${name}.md`), 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_SKILL_BYTES) {
    return `${raw.slice(0, MAX_SKILL_BYTES)}\n… (truncated)`;
  }
  return raw;
}

/** 只读技能加载工具：模型按概览清单中的名称取回技能全文。 */
export function createLoadSkillTool(workspace: string): ToolContract<LoadSkillArgs, string> {
  return {
    name: 'load_skill',
    description:
      'Load the full instructions of a workspace skill by name ' +
      '(see "Available skills" in the workspace overview). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from the workspace overview' },
      },
      required: ['name'],
    },
    execute: async (args) => {
      try {
        return await readSkill(workspace, args.name);
      } catch {
        const known = await listSkills(workspace);
        const list = known.length > 0 ? known.map((skill) => skill.name).join(', ') : '(none)';
        return `Skill "${args.name}" not found. Available skills: ${list}`;
      }
    },
  };
}

/** 生成概览的 Available skills 段落；无技能时返回空串（宿主不拼接）。 */
export function buildSkillsOverviewSection(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return '';
  }
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return `Available skills (load full instructions with the load_skill tool):\n${lines.join('\n')}`;
}

/** 首个非空行去掉 markdown 标题符号后作为描述；无内容时回退占位。 */
function firstDescription(raw: string): string {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim().replace(/^#+\s*/, '');
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '(no description)';
}
