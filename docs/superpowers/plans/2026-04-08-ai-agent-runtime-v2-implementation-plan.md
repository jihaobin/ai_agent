# AI Agent Runtime V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前直接写在 `index.ts` 中的 OpenAI 专有 demo，重构为基于 V2 设计文档的最小可扩展运行时骨架，支持统一模型协议、provider 变换层、轻量工具运行时协议，以及可插拔的工具注册。

**Architecture:** 保留 AI SDK 作为底层模型接入方式，但把系统拆为 `provider`、`tool`、`agent`、`runtime` 四个核心模块。第一阶段只实现最小闭环：统一模型描述、基础 provider 变换、轻量工具 envelope、工具注册和一个可运行的 `search agent`，暂不实现完整的 provider 原生工具适配和复杂消息持久化。

**Tech Stack:** Bun、TypeScript、Vercel AI SDK、`@ai-sdk/openai`、Zod、`bun:test`

---

## 预备说明

当前工作区已是 git 仓库（`git rev-parse --is-inside-work-tree` 返回 `true`）。建议在关键任务完成后提交变更；如需按任务粒度追踪，可在每个任务结束后执行一次小提交。

## 目标文件结构

本计划完成后，代码结构应演进为：

```txt
/root/ai_agent/
  index.ts
  typewriter.ts
  typewriter.test.ts
  src/
    agent/
      search-agent.ts
    provider/
      model.ts
      registry.ts
      transform.ts
    tool/
      tool.ts
      registry.ts
      builtins/
        run-code.ts
        web-search.ts
    runtime/
      stream-agent.ts
  tests/
    provider-transform.test.ts
    tool-registry.test.ts
    search-agent.test.ts
```

文件职责如下：

- `index.ts`：最薄的 CLI 入口，只负责启动 agent 和输出流式文本
- `src/provider/model.ts`：模型描述协议与能力画像类型
- `src/provider/registry.ts`：provider 初始化与统一模型解析
- `src/provider/transform.ts`：provider messages/schema/options 变换
- `src/tool/tool.ts`：轻量工具运行时协议与 envelope
- `src/tool/registry.ts`：按模型能力返回可用工具集合
- `src/tool/builtins/run-code.ts`：最小内建工具示例
- `src/tool/builtins/web-search.ts`：应用侧 `web_search` 工具定义
- `src/agent/search-agent.ts`：组装 `ToolLoopAgent`
- `src/runtime/stream-agent.ts`：统一 stream 启动逻辑
- `tests/*.test.ts`：围绕 provider 变换、工具注册和 agent 组装的最小测试集

## Task 1: 搭建运行时骨架与目录结构

**Files:**
- Create: `/root/ai_agent/src/provider/model.ts`
- Create: `/root/ai_agent/src/provider/registry.ts`
- Create: `/root/ai_agent/src/provider/transform.ts`
- Create: `/root/ai_agent/src/tool/tool.ts`
- Create: `/root/ai_agent/src/tool/registry.ts`
- Create: `/root/ai_agent/src/tool/builtins/run-code.ts`
- Create: `/root/ai_agent/src/tool/builtins/web-search.ts`
- Create: `/root/ai_agent/src/agent/search-agent.ts`
- Create: `/root/ai_agent/src/runtime/stream-agent.ts`
- Modify: `/root/ai_agent/index.ts`

- [ ] **Step 1: 先写 provider 模型协议的测试草稿**

创建 `/root/ai_agent/tests/provider-transform.test.ts`，先写出最小断言骨架：

```ts
import { describe, expect, test } from "bun:test";
import { buildModelCapabilities, createRegisteredModel } from "../src/provider/model";

describe("provider model protocol", () => {
  test("builds a registered model with explicit capabilities", () => {
    const model = createRegisteredModel({
      id: "gpt-5.4",
      providerID: "openai",
      api: {
        id: "gpt-5.4",
        npm: "@ai-sdk/openai",
      },
      capabilities: buildModelCapabilities({
        toolcall: true,
        reasoning: true,
      }),
      limit: {
        context: 128000,
        output: 16000,
      },
    });

    expect(model.providerID).toBe("openai");
    expect(model.capabilities.toolcall).toBe(true);
    expect(model.capabilities.input.text).toBe(true);
    expect(model.limit.context).toBe(128000);
  });
});
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `bun test /root/ai_agent/tests/provider-transform.test.ts`
Expected: FAIL，报错提示 `../src/provider/model` 不存在

- [ ] **Step 3: 实现最小的 provider 模型协议**

创建 `/root/ai_agent/src/provider/model.ts`：

```ts
export type ModelCapabilities = {
  temperature: boolean;
  reasoning: boolean;
  attachment: boolean;
  toolcall: boolean;
  input: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
  output: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
  interleaved:
    | false
    | true
    | {
        field: "reasoning_content" | "reasoning_details";
      };
};

export type RegisteredModel = {
  id: string;
  providerID: string;
  name: string;
  api: {
    id: string;
    npm: string;
    url?: string;
  };
  capabilities: ModelCapabilities;
  options: Record<string, unknown>;
  headers: Record<string, string>;
  limit: {
    context: number;
    input?: number;
    output: number;
  };
};

export function buildModelCapabilities(
  overrides: Partial<ModelCapabilities> = {},
): ModelCapabilities {
  return {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: false,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
    ...overrides,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
      ...(overrides.input ?? {}),
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
      ...(overrides.output ?? {}),
    },
  };
}

export function createRegisteredModel(
  input: Pick<RegisteredModel, "id" | "providerID" | "api" | "capabilities" | "limit"> &
    Partial<Omit<RegisteredModel, "id" | "providerID" | "api" | "capabilities" | "limit">>,
): RegisteredModel {
  return {
    id: input.id,
    providerID: input.providerID,
    name: input.name ?? input.id,
    api: input.api,
    capabilities: input.capabilities,
    options: input.options ?? {},
    headers: input.headers ?? {},
    limit: input.limit,
  };
}
```

- [ ] **Step 4: 实现最薄的入口和空壳模块**

创建其余空壳文件，保证后续任务能在稳定结构上迭代：

`/root/ai_agent/src/provider/registry.ts`

```ts
export {};
```

`/root/ai_agent/src/provider/transform.ts`

```ts
export {};
```

`/root/ai_agent/src/tool/tool.ts`

```ts
export {};
```

`/root/ai_agent/src/tool/registry.ts`

```ts
export {};
```

`/root/ai_agent/src/tool/builtins/run-code.ts`

```ts
export {};
```

`/root/ai_agent/src/tool/builtins/web-search.ts`

```ts
export {};
```

`/root/ai_agent/src/agent/search-agent.ts`

```ts
export {};
```

`/root/ai_agent/src/runtime/stream-agent.ts`

```ts
export {};
```

将 `/root/ai_agent/index.ts` 暂时改为：

```ts
process.stdout.write("Runtime bootstrap initialized\n");
```

- [ ] **Step 5: 运行测试确认骨架稳定**

Run: `bun test /root/ai_agent/tests/provider-transform.test.ts`
Expected: PASS

## Task 2: 实现 Provider Registry 与统一模型解析

**Files:**
- Modify: `/root/ai_agent/src/provider/registry.ts`
- Test: `/root/ai_agent/tests/provider-transform.test.ts`

- [ ] **Step 1: 为模型解析写失败测试**

在 `/root/ai_agent/tests/provider-transform.test.ts` 追加：

```ts
import { createProviderRegistryEntry, resolveModel } from "../src/provider/registry";

test("resolves a configured OpenAI model into a registered model", () => {
  const entry = createProviderRegistryEntry({
    providerID: "openai",
    modelID: "gpt-5.4",
    baseURL: "https://www.open1.codes",
    apiKey: "test-key",
  });

  const model = resolveModel(entry);

  expect(model.providerID).toBe("openai");
  expect(model.id).toBe("gpt-5.4");
  expect(model.api.npm).toBe("@ai-sdk/openai");
  expect(model.capabilities.toolcall).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test /root/ai_agent/tests/provider-transform.test.ts`
Expected: FAIL，报错 `createProviderRegistryEntry` 或 `resolveModel` 未导出

- [ ] **Step 3: 实现最小 provider registry**

将 `/root/ai_agent/src/provider/registry.ts` 改为：

```ts
import { createOpenAI } from "@ai-sdk/openai";
import {
  buildModelCapabilities,
  createRegisteredModel,
  type RegisteredModel,
} from "./model";

export type ProviderRegistryEntry = {
  providerID: "openai";
  modelID: string;
  baseURL?: string;
  apiKey: string;
};

export function createProviderRegistryEntry(
  input: ProviderRegistryEntry,
): ProviderRegistryEntry {
  return input;
}

export function resolveModel(input: ProviderRegistryEntry): RegisteredModel {
  return createRegisteredModel({
    id: input.modelID,
    providerID: input.providerID,
    api: {
      id: input.modelID,
      npm: "@ai-sdk/openai",
      url: input.baseURL,
    },
    capabilities: buildModelCapabilities({
      reasoning: true,
      toolcall: true,
      attachment: true,
      input: {
        text: true,
        image: true,
        pdf: true,
      },
    }),
    limit: {
      context: 128000,
      output: 16000,
    },
  });
}

export function createLanguageModel(input: ProviderRegistryEntry) {
  const openai = createOpenAI({
    baseURL: input.baseURL,
    apiKey: input.apiKey,
  });

  return openai(input.modelID);
}
```

- [ ] **Step 4: 运行测试验证模型解析通过**

Run: `bun test /root/ai_agent/tests/provider-transform.test.ts`
Expected: PASS

## Task 3: 实现 Provider Transform 的最小闭环

**Files:**
- Modify: `/root/ai_agent/src/provider/transform.ts`
- Test: `/root/ai_agent/tests/provider-transform.test.ts`

- [ ] **Step 1: 为 options 和 schema 变换写失败测试**

在 `/root/ai_agent/tests/provider-transform.test.ts` 追加：

```ts
import { z } from "zod";
import {
  deriveDefaultOptions,
  transformProviderOptions,
  transformSchema,
} from "../src/provider/transform";

test("derives provider options for OpenAI responses models", () => {
  const model = createRegisteredModel({
    id: "gpt-5.4",
    providerID: "openai",
    api: {
      id: "gpt-5.4",
      npm: "@ai-sdk/openai",
    },
    capabilities: buildModelCapabilities({
      reasoning: true,
      toolcall: true,
    }),
    limit: {
      context: 128000,
      output: 16000,
    },
  });

  const defaults = deriveDefaultOptions(model, { sessionID: "session-1" });
  const providerOptions = transformProviderOptions(model, defaults);

  expect(defaults.store).toBe(false);
  expect(defaults.promptCacheKey).toBe("session-1");
  expect(providerOptions).toEqual({
    openai: defaults,
  });
});

test("keeps tool schema object-compatible for OpenAI", () => {
  const model = createRegisteredModel({
    id: "gpt-5.4",
    providerID: "openai",
    api: {
      id: "gpt-5.4",
      npm: "@ai-sdk/openai",
    },
    capabilities: buildModelCapabilities({
      toolcall: true,
    }),
    limit: {
      context: 128000,
      output: 16000,
    },
  });

  const schema = z.toJSONSchema(
    z.object({
      query: z.string(),
      limit: z.number().int().optional(),
    }),
  );

  expect(transformSchema(model, schema)).toEqual(schema);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test /root/ai_agent/tests/provider-transform.test.ts`
Expected: FAIL，提示 `deriveDefaultOptions`、`transformProviderOptions` 或 `transformSchema` 未实现

- [ ] **Step 3: 实现最小 provider transform**

将 `/root/ai_agent/src/provider/transform.ts` 改为：

```ts
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { RegisteredModel } from "./model";

export function deriveDefaultOptions(
  model: RegisteredModel,
  context: { sessionID: string },
) {
  const result: Record<string, unknown> = {};

  if (model.providerID === "openai" || model.api.npm === "@ai-sdk/openai") {
    result.store = false;
    result.promptCacheKey = context.sessionID;
  }

  if (model.capabilities.reasoning && model.api.id.startsWith("gpt-5")) {
    result.reasoningEffort = "medium";
    result.reasoningSummary = "auto";
  }

  return result;
}

export function transformProviderOptions(
  model: RegisteredModel,
  options: Record<string, unknown>,
) {
  if (model.api.npm === "@ai-sdk/openai") {
    return {
      openai: options,
    };
  }

  return {
    [model.providerID]: options,
  };
}

export function transformSchema(
  _model: RegisteredModel,
  schema: JSONSchema7,
): JSONSchema7 {
  return schema;
}
```

- [ ] **Step 4: 运行测试验证 provider transform 通过**

Run: `bun test /root/ai_agent/tests/provider-transform.test.ts`
Expected: PASS

## Task 4: 实现轻量工具运行时协议与两个内建工具

**Files:**
- Modify: `/root/ai_agent/src/tool/tool.ts`
- Modify: `/root/ai_agent/src/tool/builtins/run-code.ts`
- Modify: `/root/ai_agent/src/tool/builtins/web-search.ts`
- Test: `/root/ai_agent/tests/tool-registry.test.ts`

- [ ] **Step 1: 为工具 envelope 写失败测试**

创建 `/root/ai_agent/tests/tool-registry.test.ts`：

```ts
import { expect, test } from "bun:test";
import { createRunCodeTool } from "../src/tool/builtins/run-code";
import { createWebSearchTool } from "../src/tool/builtins/web-search";

test("run-code tool returns the standard result envelope", async () => {
  const tool = createRunCodeTool();
  const result = await tool.execute(
    { code: "print('hi')" },
    {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "search",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    },
  );

  expect(result.title).toBe("Run code");
  expect(typeof result.output).toBe("string");
  expect(result.metadata).toEqual({});
});

test("web-search tool returns the standard result envelope", async () => {
  const tool = createWebSearchTool();
  const result = await tool.execute(
    { query: "vite 8 changelog" },
    {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "search",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    },
  );

  expect(result.title).toBe("Web search");
  expect(result.output).toContain("vite 8 changelog");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test /root/ai_agent/tests/tool-registry.test.ts`
Expected: FAIL，提示工具模块未实现

- [ ] **Step 3: 实现工具运行时协议**

将 `/root/ai_agent/src/tool/tool.ts` 改为：

```ts
import type { z } from "zod";

export type ToolAttachment = {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
};

export type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
  callID?: string;
  messages: unknown[];
  extra?: Record<string, unknown>;
  metadata(input: {
    title?: string;
    metadata?: Record<string, unknown>;
  }): void;
  ask(input: Record<string, unknown>): Promise<void>;
};

export type ToolResultEnvelope = {
  title: string;
  metadata: Record<string, unknown>;
  output: string;
  attachments?: ToolAttachment[];
};

export type ToolDefinition<TParameters extends z.ZodType> = {
  id: string;
  description: string;
  parameters: TParameters;
  execute(
    args: z.infer<TParameters>,
    ctx: ToolContext,
  ): Promise<ToolResultEnvelope>;
  formatValidationError?: (error: Error) => string;
};
```

- [ ] **Step 4: 实现两个内建工具**

将 `/root/ai_agent/src/tool/builtins/run-code.ts` 改为：

```ts
import { z } from "zod";
import type { ToolDefinition } from "../tool";

export function createRunCodeTool(): ToolDefinition<z.ZodObject<{ code: z.ZodString }>> {
  return {
    id: "run_code",
    description: "Execute code in a controlled runtime.",
    parameters: z.object({
      code: z.string(),
    }),
    async execute({ code }) {
      return {
        title: "Run code",
        metadata: {},
        output: `Execution request received.\n\n${code}`,
      };
    },
  };
}
```

将 `/root/ai_agent/src/tool/builtins/web-search.ts` 改为：

```ts
import { z } from "zod";
import type { ToolDefinition } from "../tool";

export function createWebSearchTool(): ToolDefinition<
  z.ZodObject<{ query: z.ZodString }>
> {
  return {
    id: "web_search",
    description: "Search the web using the application runtime.",
    parameters: z.object({
      query: z.string(),
    }),
    async execute({ query }, ctx) {
      await ctx.ask({
        permission: "web_search",
        query,
      });

      return {
        title: "Web search",
        metadata: {
          strategy: "application-tool",
        },
        output: `Search query accepted: ${query}`,
      };
    },
  };
}
```

- [ ] **Step 5: 运行测试验证工具 envelope 正常**

Run: `bun test /root/ai_agent/tests/tool-registry.test.ts`
Expected: PASS

## Task 5: 实现 Tool Registry，并把工具注册给 AI SDK

**Files:**
- Modify: `/root/ai_agent/src/tool/registry.ts`
- Modify: `/root/ai_agent/src/agent/search-agent.ts`
- Test: `/root/ai_agent/tests/search-agent.test.ts`

- [ ] **Step 1: 为工具注册和 agent 装配写失败测试**

创建 `/root/ai_agent/tests/search-agent.test.ts`：

```ts
import { expect, test } from "bun:test";
import { createProviderRegistryEntry, resolveModel } from "../src/provider/registry";
import { createToolRegistry } from "../src/tool/registry";

test("tool registry exposes built-in tools based on model capability", () => {
  const model = resolveModel(
    createProviderRegistryEntry({
      providerID: "openai",
      modelID: "gpt-5.4",
      apiKey: "test-key",
    }),
  );

  const tools = createToolRegistry(model);

  expect(Object.keys(tools)).toEqual(["run_code", "web_search"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test /root/ai_agent/tests/search-agent.test.ts`
Expected: FAIL，提示 `createToolRegistry` 未实现

- [ ] **Step 3: 实现工具注册层**

将 `/root/ai_agent/src/tool/registry.ts` 改为：

```ts
import type { RegisteredModel } from "../provider/model";
import { createRunCodeTool } from "./builtins/run-code";
import { createWebSearchTool } from "./builtins/web-search";

export function createToolRegistry(model: RegisteredModel) {
  const tools = {
    run_code: createRunCodeTool(),
  };

  if (model.capabilities.toolcall) {
    return {
      ...tools,
      web_search: createWebSearchTool(),
    };
  }

  return tools;
}
```

- [ ] **Step 4: 实现最小 search agent 组装**

将 `/root/ai_agent/src/agent/search-agent.ts` 改为：

```ts
import { ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import type { ProviderRegistryEntry } from "../provider/registry";
import { createLanguageModel, resolveModel } from "../provider/registry";
import { createToolRegistry } from "../tool/registry";

export function createSearchAgent(entry: ProviderRegistryEntry) {
  const model = resolveModel(entry);
  const runtimeTools = createToolRegistry(model);

  return new ToolLoopAgent({
    model: createLanguageModel(entry),
    tools: Object.fromEntries(
      Object.entries(runtimeTools).map(([id, def]) => [
        id,
        tool({
          description: def.description,
          inputSchema: z.toJSONSchema(def.parameters) as never,
          execute: (args) =>
            def.execute(args as never, {
              sessionID: "session-cli",
              messageID: "message-cli",
              agent: "search",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => {},
              ask: async () => {},
            }),
        }),
      ]),
    ),
  });
}
```

- [ ] **Step 5: 运行测试验证 registry 可用**

Run: `bun test /root/ai_agent/tests/search-agent.test.ts`
Expected: PASS

## Task 6: 实现运行时入口并恢复真实流式输出

**Files:**
- Modify: `/root/ai_agent/src/runtime/stream-agent.ts`
- Modify: `/root/ai_agent/index.ts`
- Test: `/root/ai_agent/tests/search-agent.test.ts`

- [ ] **Step 1: 为运行时入口写最小集成测试**

在 `/root/ai_agent/tests/search-agent.test.ts` 追加：

```ts
import { createSearchRuntimeConfig } from "../src/runtime/stream-agent";

test("runtime config resolves the default prompt and provider entry", () => {
  const runtime = createSearchRuntimeConfig();

  expect(runtime.prompt).toContain("vite 8");
  expect(runtime.provider.providerID).toBe("openai");
  expect(runtime.provider.modelID).toBe("gpt-5.4");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test /root/ai_agent/tests/search-agent.test.ts`
Expected: FAIL，提示 `createSearchRuntimeConfig` 未实现

- [ ] **Step 3: 实现运行时入口配置**

将 `/root/ai_agent/src/runtime/stream-agent.ts` 改为：

```ts
import { createSearchAgent } from "../agent/search-agent";

export function createSearchRuntimeConfig() {
  return {
    prompt: "vite 8更新了些什么东西？vite+又是什么",
    provider: {
      providerID: "openai" as const,
      modelID: "gpt-5.4",
      baseURL: "https://www.open1.codes",
      apiKey: "sk-22439f3ab33db594bae5b7f1da55c742d086789512b15aa6237eb5fa0a83436d",
    },
  };
}

export async function streamSearchAgent() {
  const runtime = createSearchRuntimeConfig();
  const agent = createSearchAgent(runtime.provider);
  return agent.stream({
    prompt: runtime.prompt,
  });
}
```

- [ ] **Step 4: 恢复 CLI 入口**

将 `/root/ai_agent/index.ts` 改为：

```ts
import { streamSearchAgent } from "./src/runtime/stream-agent";
import { writeTypewriterText } from "./typewriter";

const result = await streamSearchAgent();

for await (const chunk of result.textStream) {
  await writeTypewriterText(chunk);
}

process.stdout.write("\n");
```

- [ ] **Step 5: 运行全部测试**

Run: `bun test`
Expected: PASS，包含：
- `typewriter.test.ts`
- `tests/provider-transform.test.ts`
- `tests/tool-registry.test.ts`
- `tests/search-agent.test.ts`

## Task 7: 清理硬编码并准备下一阶段扩展

**Files:**
- Modify: `/root/ai_agent/src/runtime/stream-agent.ts`
- Modify: `/root/ai_agent/README.md`

- [ ] **Step 1: 去掉运行时中的敏感硬编码**

将 `/root/ai_agent/src/runtime/stream-agent.ts` 中的 provider 配置替换为环境变量读取：

```ts
export function createSearchRuntimeConfig() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return {
    prompt: "vite 8更新了些什么东西？vite+又是什么",
    provider: {
      providerID: "openai" as const,
      modelID: process.env.OPENAI_MODEL_ID ?? "gpt-5.4",
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey,
    },
  };
}
```

- [ ] **Step 2: 更新 README 说明新的运行方式**

将 `/root/ai_agent/README.md` 更新为：

````md
# ai_agent

## Install

```bash
bun install
```

## Required environment variables

```bash
export OPENAI_API_KEY=your_api_key
export OPENAI_MODEL_ID=gpt-5.4
# optional
export OPENAI_BASE_URL=https://www.open1.codes
```

## Run

```bash
bun run index.ts
```

## Test

```bash
bun test
```
````

- [ ] **Step 3: 运行完整验证**

Run: `OPENAI_API_KEY=test-key bun test`
Expected: PASS

Run: `OPENAI_API_KEY=test-key bun run index.ts`
Expected: 程序启动并进入模型调用流程；如果测试 key 无效，应失败于真实网络调用，而不是本地模块装配错误

## Spec 覆盖检查

本计划已覆盖 V2 文档中的以下核心要求：

- 统一模型描述协议：Task 1、Task 2
- provider 变换层：Task 3
- 轻量工具运行时协议：Task 4
- 工具注册与执行层：Task 5
- agent 组装层：Task 5、Task 6
- 渐进式落地策略：Task 1 到 Task 7

本计划暂未实现以下高级项，属于下一轮计划范围：

- 多 provider 并行注册
- 完整的消息回放兼容层
- provider 原生工具 adapter
- 完整的 tool result attachments 回灌
- 持久化会话与权限审批 UI

这些内容没有遗漏，而是被明确切分到下一阶段，符合当前小型仓库的渐进式演进目标。
