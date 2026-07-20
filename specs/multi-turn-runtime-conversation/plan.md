# Plan

1. Extend `AgentRunRequest` with messages and conversation identifiers.
2. Build both A2A `message` and OpenAI/LangChain-style `messages` payloads.
3. Generate separate user message id, assistant message id, and turn id.
4. Reset thread id on chat reset.
5. Update runtime adapter docs and tests.
