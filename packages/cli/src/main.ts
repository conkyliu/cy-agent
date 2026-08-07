#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { AgentSession, ToolRegistry } from '@cy-agent/agent';
import { OpenAICompatProvider } from '@cy-agent/openai-provider';
import type { Message } from '@cy-agent/protocol';
import { JsonFileSessionStore } from '@cy-agent/storage';
import { createCodingTools, createRunShellTool } from '@cy-agent/tools';
import { HELP_TEXT, loadConfig, parseCliArgs } from './config.js';
import { runRepl } from './repl.js';

const SYSTEM_PROMPT = `You are cy-agent, a coding assistant operating inside the user's workspace.
Use the provided tools (read_file, write_file, list_directory, search_files, run_shell) to inspect and modify code.
Be concise. write_file and run_shell require explicit user approval and will be prompted automatically.`;

async function main(): Promise<void> {
  const flags = parseCliArgs(process.argv.slice(2));
  if (flags.has('help')) {
    process.stdout.write(HELP_TEXT);
    return;
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

  const providerOptions: ConstructorParameters<typeof OpenAICompatProvider>[0] = {
    apiKey: config.apiKey,
    model: config.model,
  };
  if (config.baseUrl !== undefined) {
    providerOptions.baseUrl = config.baseUrl;
  }
  const provider = new OpenAICompatProvider(providerOptions);

  const registry = new ToolRegistry();
  for (const tool of createCodingTools(config.cwd)) {
    registry.register(tool);
  }
  registry.register(createRunShellTool(config.cwd));

  // 会话历史持久化：工作区内 .cy-agent/sessions。
  const store = new JsonFileSessionStore(path.join(config.cwd, '.cy-agent', 'sessions'));

  let initialMessages: Message[] | undefined;
  if (config.resume !== undefined) {
    const stored = await store.load(config.resume);
    if (stored === null) {
      process.stderr.write(`✗ Session "${config.resume}" not found. Use /sessions to list saved sessions.\n`);
      process.exitCode = 1;
      return;
    }
    initialMessages = stored.messages;
  }

  const sessionOptions: ConstructorParameters<typeof AgentSession>[0] = {
    provider,
    registry,
    systemPrompt: SYSTEM_PROMPT,
  };
  if (initialMessages !== undefined) {
    sessionOptions.initialMessages = initialMessages;
  }
  const session = new AgentSession(sessionOptions);

  process.stdout.write(`cy-agent · model: ${config.model} · cwd: ${config.cwd}\n`);
  if (config.resume !== undefined) {
    process.stdout.write(`Resumed session ${config.resume} (${initialMessages?.length ?? 0} messages)\n`);
  }
  await runRepl({ session, color: process.stdout.isTTY === true, store });
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
