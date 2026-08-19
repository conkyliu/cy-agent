#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { AgentSession, ToolRegistry, type ProviderContract } from '@cy-agent/agent';
import { AnthropicProvider } from '@cy-agent/anthropic-provider';
import { GeminiProvider } from '@cy-agent/gemini-provider';
import { OpenAICompatProvider } from '@cy-agent/openai-provider';
import type { Message } from '@cy-agent/protocol';
import { JsonFileSessionStore } from '@cy-agent/storage';
import {
  buildSymbolIndexSection,
  buildWorkspaceOverview,
  closeMcpServers,
  createCodingTools,
  createLoadSkillTool,
  createRunShellTool,
  loadExtensions,
  withWorkspaceOverview,
  type LoadExtensionsOptions,
} from '@cy-agent/tools';
import { HELP_TEXT, loadConfig, parseCliArgs, parsePositionals } from './config.js';
import { persistSession, runRepl } from './repl.js';
import { readStdinPrompt, runOnce } from './run-once.js';

const BASE_SYSTEM_PROMPT = `You are cy-agent, a coding assistant operating inside the user's workspace.
Use the provided tools (read_file, write_file, list_directory, search_files, run_shell) to inspect and modify code.
Be concise. write_file and run_shell require explicit user approval and will be prompted automatically.`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseCliArgs(argv);
  if (flags.has('help')) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  // 单次执行提示词：-p/--prompt > 位置参数 > stdin（-p - / 空 -p）。
  let oneShotPrompt: string | undefined;
  if (flags.has('prompt')) {
    const raw = flags.get('prompt');
    oneShotPrompt = raw === undefined || raw === '' || raw === '-' ? await readStdinPrompt() : raw;
    if (oneShotPrompt.length === 0) {
      process.stderr.write('✗ Empty prompt. Pass text to -p/--prompt or pipe it via stdin.\n');
      process.exitCode = 1;
      return;
    }
  } else {
    const positionals = parsePositionals(argv);
    if (positionals.length > 0) {
      oneShotPrompt = positionals.join(' ');
    }
  }

  let config;
  try {
    config = loadConfig(process.env, flags, process.cwd());
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(HELP_TEXT);
    process.exitCode = 1;
    return;
  }

  let provider: ProviderContract;
  if (config.provider === 'anthropic') {
    provider = new AnthropicProvider({
      apiKey: config.apiKey,
      model: config.model,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  } else if (config.provider === 'gemini') {
    provider = new GeminiProvider({
      apiKey: config.apiKey,
      model: config.model,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  } else {
    const providerOptions: ConstructorParameters<typeof OpenAICompatProvider>[0] = {
      apiKey: config.apiKey,
      model: config.model,
    };
    if (config.baseUrl !== undefined) {
      providerOptions.baseUrl = config.baseUrl;
    }
    provider = new OpenAICompatProvider(providerOptions);
  }

  const registry = new ToolRegistry();
  for (const tool of createCodingTools(config.cwd)) {
    registry.register(tool);
  }
  registry.register(createRunShellTool(config.cwd));

  // 扩展装配：MCP 工具 + 本地插件 + 技能（失败降级，绝不阻塞启动）。
  const extensionOptions: LoadExtensionsOptions = {};
  if (config.mcpConfig !== undefined) {
    extensionOptions.mcpConfig = config.mcpConfig;
  }
  const extensions = await loadExtensions(config.cwd, extensionOptions);
  for (const tool of extensions.tools) {
    registry.register(tool);
  }
  if (extensions.skills.length > 0) {
    registry.register(createLoadSkillTool(config.cwd));
  }
  for (const warning of extensions.warnings) {
    process.stderr.write(`! ${warning}\n`);
  }
  process.on('exit', () => closeMcpServers(extensions.mcpServers));

  // systemPrompt 追加工作区概览：模型首轮即预知目录结构（生成失败静默降级）。
  let systemPrompt = withWorkspaceOverview(
    BASE_SYSTEM_PROMPT,
    await buildWorkspaceOverview(config.cwd),
  );
  if (extensions.skillsSection.length > 0) {
    systemPrompt = `${systemPrompt}\n\n${extensions.skillsSection}`;
  }
  const symbolSection = buildSymbolIndexSection(extensions.symbolIndex);
  if (symbolSection.length > 0) {
    systemPrompt = `${systemPrompt}\n\n${symbolSection}`;
  }

  // 会话历史持久化：工作区内 .cy-agent/sessions。
  const store = new JsonFileSessionStore(path.join(config.cwd, '.cy-agent', 'sessions'));

  let initialMessages: Message[] | undefined;
  if (config.resume !== undefined) {
    const stored = await store.load(config.resume);
    if (stored === null) {
      process.stderr.write(
        `✗ Session "${config.resume}" not found. Use /sessions to list saved sessions.\n`,
      );
      process.exitCode = 1;
      return;
    }
    initialMessages = stored.messages;
  }

  const sessionOptions: ConstructorParameters<typeof AgentSession>[0] = {
    provider,
    registry,
    systemPrompt,
  };
  if (initialMessages !== undefined) {
    sessionOptions.initialMessages = initialMessages;
  }
  if (config.resume !== undefined) {
    // 保留原会话 ID，后续每轮存档写回同一文件。
    sessionOptions.id = config.resume;
  }
  const session = new AgentSession(sessionOptions);

  if (oneShotPrompt !== undefined) {
    // 非交互单次执行：跑一轮即退出，供脚本与 CI 使用。
    const result = await runOnce({
      session,
      prompt: oneShotPrompt,
      json: config.output === 'json',
      autoApprove: config.yes === true,
      color: process.stderr.isTTY === true,
    });
    // 部分进展同样落盘，支持 --resume 多轮串联。
    await persistSession(session, store, (text) => process.stderr.write(text));
    process.exitCode = result.status === 'completed' ? 0 : result.status === 'cancelled' ? 130 : 1;
    return;
  }

  // 会话工厂：/new 与 /open 用它重建会话（systemPrompt 重新注入）。
  const createSession = (messages?: Message[], sessionId?: string): AgentSession => {
    const options: ConstructorParameters<typeof AgentSession>[0] = {
      provider,
      registry,
      systemPrompt,
    };
    if (messages !== undefined) {
      options.initialMessages = messages;
    }
    if (sessionId !== undefined) {
      options.id = sessionId;
    }
    return new AgentSession(options);
  };

  process.stdout.write(`cy-agent · model: ${config.model} · cwd: ${config.cwd}\n`);
  if (config.resume !== undefined) {
    process.stdout.write(
      `Resumed session ${config.resume} (${initialMessages?.length ?? 0} messages)\n`,
    );
  }
  await runRepl({ session, color: process.stdout.isTTY === true, store, createSession });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
