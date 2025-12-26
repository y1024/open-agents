import {
  type ChatTransport,
  ToolLoopAgent,
  type UIMessage,
  convertToModelMessages,
} from "ai";

export type AgentTransportOptions = {
  agent: ToolLoopAgent<any, any, any>;
  agentOptions?: Record<string, unknown>;
};

export function createAgentTransport({
  agent,
  agentOptions,
}: AgentTransportOptions): ChatTransport<UIMessage> {
  return {
    sendMessages: async ({ messages, abortSignal }) => {
      const modelMessages = await convertToModelMessages(messages);

      const result = await agent.stream({
        messages: modelMessages,
        options: agentOptions,
        abortSignal: abortSignal ?? undefined,
      });

      return result.toUIMessageStream();
    },

    reconnectToStream: async () => {
      // Not supported for local agent calls
      return null;
    },
  };
}
