import type { AiProvider } from "./config.js";

export type ModelCard = {
  id: string;
  name: string;
  provider: AiProvider;
  note: string;
  context: string;
};

export const freeModelCatalog = {
  gemini: [
    {
      id: "gemini-3.7-flash",
      name: "Gemini 3.7 Flash",
      provider: "gemini",
      note: "AI Studio stable text model",
      context: "Agentic coding and reasoning"
    },
    {
      id: "gemini-3.6-flash",
      name: "Gemini 3.6 Flash",
      provider: "gemini",
      note: "Free tier text model",
      context: "Fast general chat"
    },
    {
      id: "gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      provider: "gemini",
      note: "AI Studio stable text model",
      context: "General chat and coding"
    },
    {
      id: "gemini-3.5-flash-lite",
      name: "Gemini 3.5 Flash-Lite",
      provider: "gemini",
      note: "Free tier text model",
      context: "High-volume chat"
    },
    {
      id: "gemini-3.1-flash-lite",
      name: "Gemini 3.1 Flash-Lite",
      provider: "gemini",
      note: "Free tier text model",
      context: "Fast and efficient"
    },
    {
      id: "gemini-3-flash-preview",
      name: "Gemini 3 Flash Preview",
      provider: "gemini",
      note: "Free tier preview",
      context: "Frontier chat and reasoning"
    },
    {
      id: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro Preview",
      provider: "gemini",
      note: "AI Studio preview text model",
      context: "Complex reasoning and coding"
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      provider: "gemini",
      note: "Free tier text model",
      context: "Complex reasoning"
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "gemini",
      note: "Free tier text model",
      context: "1M context and reasoning"
    },
    {
      id: "gemini-2.5-flash-lite",
      name: "Gemini 2.5 Flash-Lite",
      provider: "gemini",
      note: "Free tier text model",
      context: "Small and fast"
    },
    {
      id: "gemma-4-31b-it",
      name: "Gemma 4 31B",
      provider: "gemini",
      note: "Free tier open model",
      context: "Reasoning and coding"
    },
    {
      id: "gemma-4-26b-a4b-it",
      name: "Gemma 4 26B A4B",
      provider: "gemini",
      note: "Free tier open model",
      context: "Efficient reasoning"
    }
  ],
  opencode_zen: [
    {
      id: "big-pickle",
      name: "Big Pickle",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "Stealth model"
    },
    {
      id: "deepseek-v4-flash-free",
      name: "DeepSeek V4 Flash Free",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "Coding and agents"
    },
    {
      id: "mimo-v2.5-free",
      name: "MiMo V2.5 Free",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "General coding"
    },
    {
      id: "laguna-s-2.1-free",
      name: "Laguna S 2.1 Free",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "General chat"
    },
    {
      id: "ling-3.0-flash-free",
      name: "Ling-3.0 Flash Free",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "Efficient agentic chat"
    },
    {
      id: "north-mini-code-free",
      name: "North Mini Code Free",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "Small code model"
    },
    {
      id: "nemotron-3-ultra-free",
      name: "Nemotron 3 Ultra Free",
      provider: "opencode_zen",
      note: "Free Zen chat model",
      context: "Reasoning"
    }
  ],
  nvidia_nim: [
    {
      id: "deepseek-ai/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      provider: "nvidia_nim",
      note: "NVIDIA free endpoint",
      context: "Coding and agents"
    },
    {
      id: "nvidia/nemotron-3-ultra-550b-a55b",
      name: "Nemotron 3 Ultra 550B",
      provider: "nvidia_nim",
      note: "NVIDIA free endpoint",
      context: "Large reasoning"
    },
    {
      id: "nvidia/nvidia-nemotron-nano-9b-v2",
      name: "Nemotron Nano 9B v2",
      provider: "nvidia_nim",
      note: "NVIDIA free endpoint",
      context: "Fast small model"
    },
    {
      id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      name: "Nemotron 3 Nano Omni Reasoning",
      provider: "nvidia_nim",
      note: "NVIDIA free endpoint",
      context: "Omni reasoning"
    },
    {
      id: "z-ai/glm-5.2",
      name: "GLM 5.2",
      provider: "nvidia_nim",
      note: "NVIDIA NIM endpoint",
      context: "General chat"
    }
  ],
  openrouter: [
    {
      id: "poolside/laguna-xs-2.1:free",
      name: "Poolside Laguna XS 2.1",
      provider: "openrouter",
      note: "OpenRouter free model",
      context: "Coding assistant"
    },
    {
      id: "cohere/north-mini-code:free",
      name: "Cohere North Mini Code",
      provider: "openrouter",
      note: "OpenRouter free model",
      context: "Small code model"
    },
    {
      id: "tencent/hy3:free",
      name: "Tencent Hunyuan 3",
      provider: "openrouter",
      note: "OpenRouter free model",
      context: "General chat"
    },
    {
      id: "inclusionai/ling-3.0-flash:free",
      name: "Ling-3.0 Flash",
      provider: "openrouter",
      note: "OpenRouter free model",
      context: "262K context"
    }
  ],
  bynara: [
    {
      id: "mistral-large",
      name: "Mistral Large",
      provider: "bynara",
      note: "Bynara router model",
      context: "General chat"
    },
    {
      id: "mistral-medium-3-5",
      name: "Mistral Medium 3.5",
      provider: "bynara",
      note: "Bynara router model",
      context: "Balanced chat"
    }
  ]
} satisfies Record<AiProvider, ModelCard[]>;

export const getFreeModels = (provider: AiProvider) => freeModelCatalog[provider];

export const isFreeModelForProvider = (provider: AiProvider, model: string) =>
  getFreeModels(provider).some((candidate) => candidate.id === model);
