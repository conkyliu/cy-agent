import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cy-agent/protocol': here('./packages/protocol/src/index.ts'),
      '@cy-agent/agent': here('./packages/agent/src/index.ts'),
      '@cy-agent/tools': here('./packages/tools/src/index.ts'),
      '@cy-agent/openai-provider': here('./packages/openai-provider/src/index.ts'),
      '@cy-agent/cli': here('./packages/cli/src/index.ts'),
      '@cy-agent/storage': here('./packages/storage/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/dist/**', '**/node_modules/**', '**/test/**'],
    },
  },
});
