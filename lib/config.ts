export const SANDBOX_TIMEOUT_MS = 300_000; // 5 minutes in milliseconds

// Resolution boundaries used by the sandbox and optional screenshot scaling.
// The current OpenAI computer-use path sends original-detail screenshots and
// does not actively scale them before upload.
export const MAX_RESOLUTION_WIDTH = 1024;
export const MAX_RESOLUTION_HEIGHT = 768;
export const MIN_RESOLUTION_WIDTH = 640;
export const MIN_RESOLUTION_HEIGHT = 480;

// Default resolution used when none is specified
// NOTE: This should be within the max/min bounds defined above,
// otherwise it will be scaled automatically
export const DEFAULT_RESOLUTION: [number, number] = [1024, 720];

// Model identifier
export const OPENAI_MODEL = "gpt-5.4";

// Local OpenAI-compatible LLM (MODEL_PROVIDER=local). No defaults for the URL
// or model: every server (Ollama, vLLM, ...) uses a different port/path.
export const LOCAL_LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL;
export const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL;
export const LOCAL_LLM_API_KEY = process.env.LOCAL_LLM_API_KEY || "not-needed";
// Ask the server for response_format json_object; disable if it rejects it
export const LOCAL_LLM_JSON_MODE = process.env.LOCAL_LLM_JSON_MODE !== "false";
