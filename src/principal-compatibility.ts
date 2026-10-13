import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { PrincipalSelection } from "./legion-settings.js";

export type PrincipalRegistry = Pick<
  ModelRegistry,
  "find" | "getProvider" | "hasConfiguredAuth" | "getAvailable" | "getError"
>;
export type PrincipalCompatibilityIssue = {
  code: "selection" | "registry" | "model" | "provider" | "auth" | "availability" | "context" | "thinking";
  message: string;
};
export type PrincipalCompatibility =
  | { kind: "compatible"; model: Model<Api>; thinking: ModelThinkingLevel }
  | { kind: "incompatible"; issues: PrincipalCompatibilityIssue[] };

function incompatible(code: PrincipalCompatibilityIssue["code"], message: string): PrincipalCompatibility {
  return { kind: "incompatible", issues: [{ code, message }] };
}

/** Checks native registry metadata only, not successful provider-request capability.
 * The caller supplies the current snapshot; this helper never refreshes it or resolves auth.
 */
export function checkPrincipalCompatibility(input: {
  principal: "Legatus" | "Tribunus";
  selection: PrincipalSelection | undefined;
  registry: PrincipalRegistry;
}): PrincipalCompatibility {
  const selected = input.selection;
  if (!selected) {
    return incompatible("selection",
      `${input.principal} model/thinking selection is unknown. Observe the actual Pi principal selection before managed work; Legion will not infer it from defaults.`,
    );
  }
  const registryError = input.registry.getError();
  if (registryError) {
    return incompatible("registry",
      `${input.principal} native Pi registry error: ${registryError}. Correct the native model/provider configuration and verify its snapshot before retrying.`,
    );
  }
  const slash = selected.model.indexOf("/");
  const model = input.registry.find(selected.model.slice(0, slash), selected.model.slice(slash + 1));
  if (!model || `${model.provider}/${model.id}` !== selected.model) {
    return incompatible("model",
      `${input.principal} ${selected.model} is not registered as a Pi chat model. Register this exact provider/model in Pi or ask the Emperor to correct the selection; Legion will not fuzzy-match or replace it.`,
    );
  }
  if (!input.registry.getProvider(model.provider)) {
    return incompatible("provider",
      `${input.principal} ${selected.model} has no registered native Pi provider support. Register provider ${model.provider} in Pi before retrying; Legion will not install or substitute support.`,
    );
  }
  if (!input.registry.hasConfiguredAuth(model)) {
    return incompatible("auth",
      `${input.principal} ${selected.model} has no configured authentication for ${model.provider}. Configure auth through Pi before retrying; Legion will not acquire or refresh credentials.`,
    );
  }
  if (!input.registry.getAvailable().some((available) => available.provider === model.provider && available.id === model.id)) {
    return incompatible("availability",
      `${input.principal} ${selected.model} has configured auth but is absent from Pi's native available-model snapshot. Verify native provider/model support and snapshot freshness in Pi before retrying; Legion will not probe or substitute it.`,
    );
  }
  if (!Number.isFinite(model.contextWindow) || model.contextWindow < 272000) {
    return incompatible("context",
      `${input.principal} ${selected.model} has ${model.contextWindow} context tokens; at least 272000 are required. Ask the Emperor to select a supported principal model; Legion will not replace it.`,
    );
  }
  const supportedThinking = getSupportedThinkingLevels(model);
  if (!supportedThinking.includes(selected.thinking)) {
    return incompatible("thinking",
      `${input.principal} ${selected.model} thinking ${selected.thinking} is unsupported. Choose an exact supported thinking value: ${supportedThinking.join(", ")}. Legion will not clamp it.`,
    );
  }
  return { kind: "compatible", model, thinking: selected.thinking };
}
