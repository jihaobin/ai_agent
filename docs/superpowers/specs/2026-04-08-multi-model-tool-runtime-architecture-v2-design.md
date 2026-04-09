# 基于 AI SDK 的多模型与工具运行时架构设计（V2）

## 1. 背景

当前项目已经基于 Vercel AI SDK 跑通了一个最小可用的 agent 示例，并且具备基础的流式输出能力。下一阶段的目标不是只接入某一个模型供应商，而是构建一套可以长期演进的运行时架构，使系统能够稳定兼容市面上大部分常用模型，并在后续持续扩展更多工具能力。

目标兼容范围包括但不限于：

- OpenAI 及兼容 OpenAI 接口的模型
- Anthropic、Google、Azure、Bedrock 等主流云模型
- OpenRouter、Vercel Gateway 等聚合层
- 本地部署或自托管模型

这些模型虽然大多都能通过 AI SDK 接入，但在以下方面存在显著差异：

- 支持的消息格式不同
- tool calling 行为不完全一致
- 对 schema 的容忍度不同
- providerOptions 的命名和结构不同
- 是否支持 reasoning、attachments、interleaved thinking、tool result media 各不相同
- 某些 provider 有原生工具能力，某些完全没有

因此，系统的核心问题并不是“如何抽象某一个业务工具”，而是“如何建立一套稳定的运行时协议，把模型差异、工具执行、消息回放和结果展示隔离开来”。

## 2. 设计目标

- 以 Vercel AI SDK 作为统一模型接入层，兼容主流 provider 和 OpenAI-compatible 模型。
- 建立统一的模型描述协议，使上层始终面对稳定的 `provider + model + capabilities` 视图。
- 建立统一的 provider 变换层，集中处理消息、schema、providerOptions 和 tool result 的兼容差异。
- 建立统一的工具运行时协议，使所有工具都能通过一致方式被注册、执行、审批、记录和回放。
- 将“provider 原生工具”视为可选优化，而不是系统主协议。
- 让 agent、UI、日志、测试依赖稳定的运行时结构，而不是某一家 provider 的原始接口。
- 为后续新增工具提供一致的扩展方式。

## 3. 非目标

- 本设计不追求统一所有 provider 的底层流事件格式。
- 本设计不要求一开始就支持所有 provider 的所有高级特性。
- 本设计不要求每个工具都定义复杂的领域级输出对象。
- 本设计不绑定某一个外部搜索服务或某一个特定工具后端。
- 本设计不以“一步到位重构为大型框架”为目标，而是优先支持渐进式演进。

## 4. 核心原则

### 4.1 模型兼容问题优先于工具抽象问题

多模型兼容的第一难点通常不是工具名称，而是 provider 差异。  
系统应该优先建立稳固的模型协议和 provider 变换层，再在其上承载工具系统。

### 4.2 工具协议应以运行时稳定性为中心

工具首先是运行时能力，不是业务 DTO。  
系统最需要统一的是：

- 工具如何声明
- 工具如何执行
- 工具如何审批
- 工具结果如何存储
- 工具结果如何重新喂回模型

而不是强制每个工具都定义复杂的领域输出结构。

### 4.3 provider 原生能力是优化，不是内核

例如 OpenAI 原生 web search、file search、code interpreter 这类能力可以接入，但只能作为某个工具的可选后端实现，不能成为应用层的主协议。

### 4.4 消息兼容层必须是一等公民

模型输入与工具结果回放不是简单字符串拼接问题。  
不同 provider 对 tool result、attachments、reasoning、empty message、toolCallId、media part 的要求不同，因此必须把消息兼容和协议修正放在独立层处理。

### 4.5 工具输出优先统一为轻量 envelope

大多数 coding agent 工具真正稳定的输出不是复杂 JSON，而是：

- 文本输出
- 附件
- 标题
- 元数据

因此系统默认应使用统一的轻量 envelope；只有少数业务型工具才需要额外定义领域级结构。

## 5. 总体架构

建议将系统拆成以下六层：

1. 模型注册层
2. 模型能力层
3. provider 变换层
4. 工具注册与执行层
5. 消息回放与兼容层
6. agent 组装层

整体数据流如下：

```txt
User Input
  -> Agent Runtime
  -> Model Registry
  -> Provider Transform
  -> Tool Registry
  -> Tool Execution
  -> Message Compatibility Layer
  -> Stream Output / Persistence / UI
```

这六层中，真正决定系统长期可维护性的，不是某一个具体工具，而是：

- 模型能力协议是否稳定
- provider 差异是否被集中收敛
- 工具结果是否有统一 envelope
- 消息回放是否和 provider 差异解耦

## 6. 模型注册层

模型注册层负责统一管理 provider、模型 ID、别名、默认配置和可用模型集合。

建议继续以 AI SDK 为接入底座，并在项目内部构建一套自己的模型协议，而不是让业务代码直接到处使用 provider-specific model id。

### 6.1 模型注册层职责

- 初始化各个 provider 实例
- 管理模型别名
- 管理默认 providerOptions
- 管理可用模型白名单
- 提供统一模型查询接口

### 6.2 建议的模型标识

建议内部统一使用：

- `providerID`
- `modelID`

必要时可以附带：

- `api.id`
- `api.npm`
- `api.url`

这样可以同时区分：

- 业务层看到的逻辑模型
- 实际落到 provider 上的底层模型标识

### 6.3 模型注册接口建议

```ts
type RegisteredModel = {
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
```

这层的目标不是只返回一个 AI SDK model instance，而是返回一份运行时真正需要的“模型描述对象”。

## 7. 模型能力层

模型能力层负责描述系统眼中的模型能力画像。  
这层不应只包含“是否支持 tool calling”，而应比这个更细。

### 7.1 建议的能力结构

```ts
type ModelCapabilities = {
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
        field: 'reasoning_content' | 'reasoning_details';
      };
};
```

### 7.2 为什么能力层要更细

因为后续运行时需要据此解决以下问题：

- 当前模型是否能接收图片、PDF
- 当前模型是否真的适合 tool calling
- 当前模型是否支持 reasoning 相关配置
- 当前模型是否支持 reasoning 内容穿插在普通文本中
- 当前模型是否支持附件型 tool result

如果能力层过粗，后面的消息兼容、schema 修正和工具结果回放都会变得脆弱。

## 8. Provider 变换层

Provider 变换层是本设计的核心。  
这一层专门负责把“统一运行时协议”变换成“各个 provider 能接受的实际请求格式”，并把 provider 差异隔离掉。

### 8.1 这一层要处理什么

- 消息归一化
- 空消息清洗
- toolCallId 修正
- 多模态输入兼容
- reasoning 相关字段映射
- providerOptions 命名空间映射
- schema 修正
- 默认参数注入
- tool result media 兼容

### 8.2 变换层职责拆分

建议拆成以下函数或模块：

- `transformMessages(model, messages, options)`
- `transformSchema(model, schema)`
- `transformProviderOptions(model, options)`
- `deriveDefaultOptions(model, sessionContext)`
- `deriveVariants(model)`

### 8.3 消息变换

消息变换负责修正 provider 差异。例如：

- 某些 provider 不接受空字符串消息
- 某些 provider 对 toolCallId 格式有限制
- 某些 provider 需要把 reasoning 从普通消息内容中拆出
- 某些 provider 对 media part 支持不完整

消息变换应当是集中式逻辑，不应该散落在 tool 实现或 agent 代码里。

### 8.4 Provider options 变换

不同 provider 对参数命名方式不同：

- OpenAI、Azure、Gateway、OpenRouter、Google、Anthropic 的 key 结构不同
- 同一个 provider 的不同 API 路径可能读取不同命名空间

因此系统内部应该先生成统一的逻辑 options，再由 provider 变换层映射到最终结构。

建议流程为：

1. 根据模型生成默认逻辑 options
2. 叠加模型级 options
3. 叠加 agent 级 options
4. 叠加 variant
5. 最后再交给 `transformProviderOptions()`

### 8.5 Schema 变换

工具 schema 不应假设所有 provider 都能接受同样的 JSON Schema。

常见问题包括：

- integer enum 不兼容
- optional 字段处理差异
- object required 字段和 properties 不一致
- array items 缺失时被拒绝

因此工具 schema 在注册给模型之前，应经过 provider 变换层修正。

### 8.6 变体与默认参数

不同模型即使都支持 reasoning，控制方式也可能完全不同。  
因此“low / medium / high / max”之类的逻辑变体，不应直接写死在业务层，而应由 provider 变换层生成。

例如：

- OpenAI 可能使用 `reasoningEffort`
- Google 可能使用 `thinkingConfig`
- Anthropic 可能使用 `thinking`
- OpenRouter 或 Gateway 可能又有自己的命名约定

运行时只应该看到“当前模型支持哪些逻辑变体”，具体映射由变换层负责。

## 9. 工具运行时协议

工具系统不应直接依赖业务级 `outputSchema`。  
默认情况下，工具应该统一实现轻量的运行时协议。

### 9.1 工具定义接口

建议工具定义统一为：

```ts
type ToolDefinition<Params = unknown, Meta = Record<string, unknown>> = {
  id: string;
  description: string;
  parameters: ZodSchema<Params>;
  execute(
    args: Params,
    ctx: ToolContext,
  ): Promise<{
    title: string;
    metadata: Meta;
    output: string;
    attachments?: ToolAttachment[];
  }>;
  formatValidationError?: (error: ZodError) => string;
};
```

### 9.2 工具上下文接口

建议工具在执行时统一收到如下上下文：

```ts
type ToolContext = {
  sessionID: string;
  messageID: string;
  callID?: string;
  agent: string;
  abort: AbortSignal;
  messages: RuntimeMessage[];
  extra?: Record<string, unknown>;
  metadata(input: {
    title?: string;
    metadata?: Record<string, unknown>;
  }): void;
  ask(input: PermissionRequest): Promise<void>;
};
```

这意味着工具系统天然支持：

- 审批
- 生命周期元数据更新
- 中断控制
- 访问上下文消息
- 运行时扩展字段

### 9.3 工具结果 envelope

建议默认采用如下 envelope：

```ts
type ToolResultEnvelope = {
  title: string;
  metadata: Record<string, unknown>;
  output: string;
  attachments?: Array<{
    type: 'file';
    mime: string;
    url: string;
    filename?: string;
  }>;
};
```

这类结果足以覆盖绝大多数 coding agent 工具：

- `read`
- `grep`
- `glob`
- `bash`
- `webfetch`
- `websearch`
- `codesearch`
- `task`
- `skill`

### 9.4 为什么默认不强制业务输出 schema

因为大量工具的本质就是“返回一段文本、一些附件和少量运行时元数据”。  
如果系统默认要求每个工具都有复杂领域输出结构，会让：

- 工具实现成本升高
- 消息回放复杂度升高
- provider 兼容处理更难

更合理的策略是：

- 默认使用统一 envelope
- 少数确实需要结构化结果的工具，再在 envelope 的 `metadata` 或独立层面增加领域协议

## 10. 工具注册层

工具注册层负责管理系统内可用工具，并在运行时基于模型、agent、权限、实验特性等因素返回当前可暴露的工具集合。

### 10.1 工具注册层职责

- 注册内建工具
- 注册插件工具
- 注册外部工具
- 按模型和 feature flag 过滤工具
- 对工具定义做最后加工

### 10.2 工具过滤原则

工具是否可用，不应只由“是否存在这个工具”决定，还应考虑：

- 当前模型是否适合该工具
- 当前 provider 是否允许该工具
- 当前 agent 权限是否允许该工具
- 当前环境变量或 feature flag 是否启用该工具

例如：

- 某些工具只在特定 provider 或特定后端存在时启用
- 某些工具会根据模型类型在 `edit/write` 和 `apply_patch` 之间切换
- 某些工具需要显式实验开关

### 10.3 注册层输出

工具注册层对上层应输出 AI SDK 可消费的工具集合，但在输出之前应经过：

- schema 变换
- execute 包装
- 审批注入
- 生命周期 hook 注入
- 插件扩展 hook 注入

## 11. Provider 原生工具策略

provider 原生工具应被视为“可选优化实现”，而不是系统主协议。

### 11.1 建议做法

对于某些工具，系统可以支持如下多实现模式：

- 应用侧标准工具实现
- provider 原生工具适配器
- 特定场景下的降级策略

但默认暴露给上层的仍然应该是应用自己的工具 ID。

### 11.2 建议边界

只有在以下条件同时满足时，才推荐接入 provider 原生工具：

- 该能力对某个 provider 的效果明显更好
- 该能力无法被应用侧工具等价替代
- 原生调用细节可以被 adapter 封装
- 上层依然只看到统一运行时语义

### 11.3 不建议的做法

不建议让主 agent 直接依赖：

- `openai.tools.webSearch()`
- `openai.tools.fileSearch()`
- 任何 provider 私有 built-in tool

否则 provider 差异会直接泄漏到业务层。

## 12. 消息回放与兼容层

工具调用不是执行完就结束了，工具结果还必须被可靠地重新送回模型。  
这一层的职责是将会话消息、工具结果、附件和元数据转换成模型下一轮所需的消息格式。

### 12.1 这层必须处理的问题

- 工具结果如何转换成 `tool-result`
- 附件是否应该作为 tool result content 返回
- 某些 provider 不支持 tool result media 时如何降级
- tool result 被压缩或截断后如何表示
- 中断中的 tool call 如何补齐错误结果，避免 dangling state

### 12.2 建议的数据处理方式

对于工具结果：

- 如果只有文本输出，则转成文本型 tool result
- 如果有文本加附件，则根据 provider 能力决定：
  - 支持 media in tool results：直接作为 content 返回
  - 不支持：把媒体附件拆成后续 user message 注入
- 如果工具被中断或失败，则显式返回错误态 result

### 12.3 为什么这层必须独立存在

因为这是 provider 差异最容易渗透到系统各处的地方。  
如果不单独收口，工具实现、agent 逻辑、UI 展示和 provider 适配会混在一起，后期很难维护。

## 13. Agent 组装层

Agent 层应尽量保持简单，只做以下事情：

- 选择模型
- 选择 agent prompt
- 选择可用工具
- 生成最终 stream 请求

Agent 层不应该负责：

- provider schema 兼容
- providerOptions 命名空间映射
- tool result media 处理
- toolCallId 修正
- reasoning 参数映射

这些都应下沉到 provider 变换层或消息兼容层。

## 14. 推荐目录结构

建议将项目逐步演进为如下结构：

```txt
src/
  agent/
    runtime.ts
    agents/
      search-agent.ts
      chat-agent.ts

  provider/
    registry.ts
    model.ts
    schema.ts
    transform.ts
    error.ts

  tool/
    tool.ts
    registry.ts
    types.ts
    builtins/
      websearch.ts
      webfetch.ts
      run-code.ts
      file-search.ts
    adapters/
      openai-web-search.ts
      openai-file-search.ts

  session/
    message.ts
    prompt.ts
    llm.ts
    replay.ts

  permission/
    index.ts

  plugin/
    index.ts

  types/
    model.ts
    tool.ts
    message.ts
```

这套目录有几个关键点：

- `provider/` 独立负责模型与 provider 协议
- `tool/` 独立负责工具定义和工具注册
- `session/` 独立负责消息构造、回放、stream 调度
- `agent/` 只负责高层组装

## 15. 对当前项目的最小落地方案

### 阶段一：先引入模型协议和 provider 变换层

第一步不要先做复杂工具抽象，而是先补齐：

- 统一 `Model` 类型
- 统一 `ModelCapabilities`
- `transformMessages()`
- `transformSchema()`
- `transformProviderOptions()`

只有这层稳了，后面加更多模型时才不会到处打补丁。

### 阶段二：把工具统一成轻量运行时协议

将现有工具逐步整理为：

- `description`
- `parameters`
- `execute(args, ctx)`
- 返回统一 envelope

这一阶段先不要强行给所有工具定义领域 `outputSchema`。

### 阶段三：引入工具注册层

把工具的注册、过滤、包装和 provider schema 修正从 agent 代码里抽出来，让 agent 只拿到“当前能用的工具集合”。

### 阶段四：把 provider 原生工具改成适配器

把 provider 原生 web search 或后续其他原生工具收进 adapter 层，只在工具内部或注册层做选择，不让业务主流程直接依赖 provider 专有 API。

### 阶段五：补齐消息回放与附件兼容

把 tool result、media attachments、interrupted tool calls、truncation、error replay 等问题集中收敛到消息层。

## 16. 测试策略

### 16.1 模型协议测试

验证：

- 模型注册是否生成正确的能力画像
- provider options 是否被映射到正确命名空间
- variant 是否生成正确

### 16.2 Provider 变换测试

验证：

- 消息清洗是否符合各 provider 约束
- schema 修正是否符合特定 provider 要求
- reasoning 配置是否按模型正确映射

### 16.3 工具运行时测试

验证：

- 参数校验
- 审批链路
- 中断处理
- 截断处理
- 统一 envelope 是否稳定

### 16.4 消息回放测试

验证：

- 工具结果能否正确回放为模型消息
- 附件能否在支持和不支持的 provider 下正确处理
- 中断的工具调用是否能补齐错误结果

## 17. 风险与取舍

### 17.1 优点

- 更适合兼容大量 provider
- provider 差异被集中收口
- 工具系统更贴近实际运行时需求
- 后续加工具和加模型的边界更清晰
- agent 组装层会保持足够轻量

### 17.2 代价

- 前期需要投入时间建立 provider 变换层
- 工具结果 envelope 相比强结构化输出更偏运行时，需要上层在必要时自行再解析
- 少数需要严格业务结构的工具，仍需额外定义二级协议

## 18. 结论

本项目的推荐方向不是“先定义一套重型 canonical business tool 协议，再让所有 provider 往上靠”，而是：

1. 先建立稳定的模型协议
2. 再建立独立的 provider 变换层
3. 再建立轻量统一的工具运行时协议
4. 再把工具结果回放和消息兼容做成独立层
5. 最后才在少数必要场景下接入 provider 原生工具优化

对于当前项目，这意味着下一阶段最值得优先投入的不是继续扩写某个具体工具的领域抽象，而是先把多模型兼容真正需要的运行时骨架搭起来。只有这样，后续无论接入更多模型，还是增加更多工具，系统都能保持稳定边界和一致行为。
