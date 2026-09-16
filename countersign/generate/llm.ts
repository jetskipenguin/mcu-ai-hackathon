import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export type Provider = "bedrock" | "openai" | "anthropic";
export interface ModelConfiguration {
  provider: Provider;
  model: string;
  region?: string;
  timeoutMs: number;
}

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Configure it in .env or the process environment.`);
  return value;
}

export function modelConfiguration(env: NodeJS.ProcessEnv = process.env): ModelConfiguration {
  const provider = env.LLM_PROVIDER ?? "openai";
  if (!["bedrock", "openai", "anthropic"].includes(provider)) throw new Error("Unsupported LLM_PROVIDER. Use openai, bedrock, or anthropic.");
  const model = required(provider === "bedrock" ? "BEDROCK_MODEL_ID" : provider === "openai" ? "OPENAI_MODEL" : "ANTHROPIC_MODEL", env);
  const timeoutMs = Number(env.LLM_TIMEOUT_MS ?? 60_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error("LLM_TIMEOUT_MS must be an integer between 1000 and 120000.");
  }
  return { provider: provider as Provider, model, timeoutMs,
    ...(provider === "bedrock" ? { region: required("AWS_REGION", env) } : {}) };
}

// Exported only to let tests exercise the real adapters without external calls.
export const llmTransport = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  bedrock: (region: string) => new BedrockRuntimeClient({ region, maxAttempts: 1 }),
};

function nonEmpty(text: unknown, provider: Provider): string {
  if (typeof text !== "string" || !text.trim()) throw new Error(`${provider} returned no text content.`);
  return text;
}

export async function complete(prompt: string, options: {
  system?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const config = modelConfiguration(env);
  const system = options.system ?? "Return only a JSON object matching the user's request.";
  const signal = AbortSignal.timeout(config.timeoutMs);
  if (config.provider === "bedrock") {
    const client = llmTransport.bedrock(config.region!);
    let response;
    try {
      response = await client.send(new ConverseCommand({
        modelId: config.model,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 8192 },
      }), { abortSignal: signal });
    } catch (error) {
      // SDK errors can contain request details. Keep credentials and payloads out
      // of browser errors and logs while retaining the actionable error class.
      const name = error instanceof Error ? error.name : "Error";
      throw new Error(`Bedrock request failed (${name}). Check credentials, model access, region, and timeout.`, { cause: error });
    } finally {
      client.destroy();
    }
    if (response.stopReason === "max_tokens") throw new Error("bedrock output was truncated; no draft was saved.");
    return nonEmpty(response.output?.message?.content?.map((item) => item.text ?? "").join(""), config.provider);
  }

  const openai = config.provider === "openai";
  const key = required(openai ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY", env);
  let response: Response;
  try {
    response = await llmTransport.fetch(openai ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: openai
        ? { authorization: `Bearer ${key}`, "content-type": "application/json" }
        : { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(openai ? {
        model: config.model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        response_format: { type: "json_object" }, max_completion_tokens: 8192,
      } : {
        model: config.model, system, messages: [{ role: "user", content: prompt }], max_tokens: 8192,
      }),
    });
  } catch (error) {
    throw new Error(`${config.provider} request failed. Check connectivity and LLM_TIMEOUT_MS.`, { cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${config.provider} returned HTTP ${response.status}. Check API credentials, model access, and quota.`);
  }
  let payload: {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    stop_reason?: string; content?: Array<{ type: string; text?: string }>;
  };
  try { payload = await response.json(); }
  catch { throw new Error(`${config.provider} returned an invalid JSON response.`); }
  if (payload.choices?.[0]?.finish_reason === "length" || payload.stop_reason === "max_tokens") {
    throw new Error(`${config.provider} output was truncated; no draft was saved.`);
  }
  return nonEmpty(openai ? payload.choices?.[0]?.message?.content
    : payload.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join(""), config.provider);
}
