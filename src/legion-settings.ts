import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

const DeliverySelection = z.strictObject({ configurationFile: z.string().min(1) });
/** Delivery is checkout-only and independent of task/model settings; errors hold delivery alone. */
export function loadDeliverySelection({ checkoutPath }: { checkoutPath: string }): string | null {
  const file = join(checkoutPath, ".pi", "legion-delivery.json");
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error(`${file}: delivery selection unavailable. ${String(error)}`);
  }
  try { return DeliverySelection.parse(JSON.parse(text)).configurationFile; }
  catch (error) { throw new Error(`${file}: invalid delivery selection; expected {configurationFile: "checkout-local path"}. ${String(error)}`); }
}

export const ThinkingSchema = z.enum(
  ["off", "minimal", "low", "medium", "high", "xhigh", "max"] satisfies ModelThinkingLevel[],
  { error: "Use a Pi thinking value: off, minimal, low, medium, high, xhigh, or max." },
);
const modelError = "Use an exact nonempty provider/model identifier.";
const ModelSelectionSchema = z.object({
  model: z.string({ error: modelError }).refine(
    (value) => value.indexOf("/") > 0 && value.indexOf("/") < value.length - 1,
    { message: modelError },
  ),
  thinking: ThinkingSchema,
});
export type PrincipalSelection = z.infer<typeof ModelSelectionSchema>;
export const StartupSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native-defaults") }),
  z.object({ kind: z.literal("exact"), selection: ModelSelectionSchema }),
]);
export type StartupSelection = z.infer<typeof StartupSelectionSchema>;

const tokenError = "Use a positive safe integer token count.";
const TokenCountSchema = z.number({ error: tokenError })
  .int({ error: tokenError }).positive({ error: tokenError });
const LegionSettingsSchema = z.object({
  context: z.object({ warningTokens: TokenCountSchema, escalationTokens: TokenCountSchema }),
  tribuni_model: ModelSelectionSchema.optional(),
}).refine((settings) => settings.context.warningTokens < settings.context.escalationTokens, {
  path: ["context", "warningTokens"],
  message: "Set context.warningTokens below context.escalationTokens.",
});
export type LegionSettings = z.infer<typeof LegionSettingsSchema>;

export const RequestedWorkflowSchema = z.enum(["unknown", "implement", "implement-spec"]);
export const WorkflowChoiceSchema = z.object({
  profile: z.enum(["matt", "poteto-mode"]),
  requestedWorkflow: RequestedWorkflowSchema,
});
export type WorkflowChoice = z.infer<typeof WorkflowChoiceSchema>;

// Historical pins retain model strings without applying configuration identifier validation.
export const AssignmentModelPinSchema = z.object({ model: z.string(), thinking: ThinkingSchema, profile: z.string() });
export type AssignmentModelPin = z.infer<typeof AssignmentModelPinSchema>;
export type TribunusModelIntent<TPin extends AssignmentModelPin = AssignmentModelPin> =
  | { kind: "new-native-defaults" }
  | { kind: "new-exact-override"; selection: PrincipalSelection }
  | { kind: "existing-pinned"; pin: TPin }
  | { kind: "existing-unknown" };

/** Existing assignments never consult newly loaded defaults or reconstruct historical pins. */
export function selectTribunusModel<TPin extends AssignmentModelPin>(input:
  | { kind: "new"; settings: LegionSettings }
  | { kind: "existing"; pin?: TPin }
): TribunusModelIntent<TPin> {
  if (input.kind === "existing") {
    return input.pin ? { kind: "existing-pinned", pin: input.pin } : { kind: "existing-unknown" };
  }
  if (input.settings.tribuni_model) {
    return { kind: "new-exact-override", selection: input.settings.tribuni_model };
  }
  return { kind: "new-native-defaults" };
}

// Validate containers and unsupported fields before merging, but validate leaves only after precedence.
const SettingsLayerSchema = z.strictObject({
  context: z.strictObject({
    warningTokens: z.unknown().optional(),
    escalationTokens: z.unknown().optional(),
  }).optional(),
  tribuni_model: z.strictObject({
    model: z.unknown().optional(),
    thinking: z.unknown().optional(),
  }).optional(),
});

async function readLayer(path: string): Promise<z.infer<typeof SettingsLayerSchema>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new Error(`${path}: cannot read configuration. Check file type and permissions. ${String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: invalid JSON. Correct the JSON syntax. ${String(error)}`);
  }
  const parsed = SettingsLayerSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => {
      const field = issue.path.join(".");
      if (issue.code === "unrecognized_keys") {
        return issue.keys.map((key) =>
          `${path}: ${field ? `${field}.` : ""}${key}: unsupported configuration. Remove this field.`,
        ).join("\n");
      }
      return `${path}: ${field || "root"}: expected a JSON object. Correct this container; null is not supported.`;
    }).join("\n"));
  }
  return parsed.data;
}

export async function loadLegionSettings(options: {
  checkoutPath: string;
  homePath?: string;
}): Promise<LegionSettings> {
  const globalPath = join(options.homePath ?? homedir(), ".pi", "agent", "legion", "legion.json");
  const checkoutPath = join(options.checkoutPath, ".pi", "legion.json");
  const global = await readLayer(globalPath);
  const checkout = await readLayer(checkoutPath);
  const parsed = LegionSettingsSchema.safeParse({
    context: {
      warningTokens: 135000,
      escalationTokens: 150000,
      ...global.context,
      ...checkout.context,
    },
    ...(global.tribuni_model || checkout.tribuni_model ? {
      tribuni_model: { ...global.tribuni_model, ...checkout.tribuni_model },
    } : {}),
  });
  if (!parsed.success) {
    const sourceFor = (container: "context" | "tribuni_model", leaf: string) => {
      const localValues = checkout[container];
      const globalValues = global[container];
      if (localValues && Object.hasOwn(localValues, leaf)) return checkoutPath;
      if (globalValues && Object.hasOwn(globalValues, leaf)) return globalPath;
      if (container === "tribuni_model") return localValues ? checkoutPath : globalPath;
      return "built-in defaults";
    };
    throw new Error(parsed.error.issues.map((issue) => {
      const field = issue.path.join(".");
      const container = issue.path[0] === "tribuni_model" ? "tribuni_model" : "context";
      const path = sourceFor(container, String(issue.path[1]));
      const escalationSource = issue.code === "custom" && container === "context"
        ? ` context.escalationTokens comes from ${sourceFor("context", "escalationTokens")}.` : "";
      return `${path}: ${field}: ${issue.message}${escalationSource}`;
    }).join("\n"));
  }
  return parsed.data;
}
