import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

type Provider = "bedrock" | "openai" | "anthropic";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function completeWithBedrock(prompt: string): Promise<string> {
  const client = new BedrockRuntimeClient({ region: required("AWS_REGION") });
  const response = await client.send(
    new ConverseCommand({
      modelId: required("BEDROCK_MODEL_ID"),
      messages: [{ role: "user", content: [{ text: prompt }] }],
    }),
  );
  const text = response.output?.message?.content?.find(
    (item) => "text" in item,
  )?.text;
  if (!text) {
    throw new Error("Bedrock returned no text content");
  }
  return text;
}

async function completeWithOpenAI(prompt: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${required("OPENAI_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: required("OPENAI_MODEL"),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned no text content");
  }
  return text;
}

export async function complete(prompt: string): Promise<string> {
  const provider = (process.env.LLM_PROVIDER ?? "bedrock") as Provider;
  switch (provider) {
    case "bedrock":
      return completeWithBedrock(prompt);
    case "openai":
      return completeWithOpenAI(prompt);
    case "anthropic":
      // TODO(track-b): implement Anthropic using ANTHROPIC_API_KEY and ANTHROPIC_MODEL.
      throw new Error("Anthropic provider is not implemented");
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${String(provider)}`);
  }
}
