import { ToolLoopAgent, tool } from 'ai';
import { createOpenAI, openai, } from "@ai-sdk/openai";
import { z } from 'zod';
import { writeTypewriterText } from "./typewriter";

const openaiProxy = createOpenAI({
    baseURL: "https://www.open1.codes",
    apiKey: "sk-22439f3ab33db594bae5b7f1da55c742d086789512b15aa6237eb5fa0a83436d"
})

const searchAgent = new ToolLoopAgent({
  model: openaiProxy("gpt-5.4"),
  tools: {
    runCode: tool({
      description: 'Execute Python code',
      inputSchema: z.object({
        code: z.string(),
      }),
      execute: async ({ code }) => {
        // Execute code and return result
        return { output: 'Code executed successfully' };
      },
    }),
    web_search: openai.tools.webSearch({
      // optional configuration:
      searchContextSize: "medium",
      userLocation: {
        type: 'approximate',
        city: 'San Francisco',
        region: 'California',
      },
    }),
  },
  // Force web search tool (optional):
  toolChoice: { type: 'tool', toolName: 'web_search' },
  },
)

const result = await searchAgent.stream({
  prompt: "vite 8更新了些什么东西？vite+又是什么"
})

for await (const chunk of result.textStream) {
  await writeTypewriterText(chunk);
}

process.stdout.write("\n");
