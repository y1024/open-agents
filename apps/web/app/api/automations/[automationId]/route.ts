import {
  deleteAutomationDefinition,
  getAutomationById,
  getOwnedAutomationById,
  listAutomationRunsByAutomationId,
  updateAutomationDefinition,
} from "@/lib/db/automations";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getAutomationNextRunAt } from "@/lib/automations/definitions";
import { kickAutomationSchedulerWorkflow } from "@/lib/automations/scheduler-kick";
import { automationUpsertInputSchema } from "@/lib/automations/types";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  serializeAutomationDetail,
  serializeAutomation,
} from "../_lib/serialize";

async function getAutomationId(
  params: Promise<{ automationId: string }>,
): Promise<string> {
  return (await params).automationId;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const automationId = await getAutomationId(context.params);
  const automation = await getOwnedAutomationById({
    automationId,
    userId: authResult.userId,
    includeDeleted: true,
  });

  if (!automation) {
    return Response.json({ error: "Automation not found" }, { status: 404 });
  }

  const runs = await listAutomationRunsByAutomationId({
    automationId,
    limit: 20,
  });

  return Response.json(serializeAutomationDetail({ automation, runs }));
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = automationUpsertInputSchema.safeParse(body);
  if (!parsedBody.success) {
    return Response.json(
      { error: "Invalid automation payload" },
      { status: 400 },
    );
  }

  const preferences = await getUserPreferences(authResult.userId);
  const normalizedInput = {
    ...parsedBody.data,
    modelId: parsedBody.data.modelId ?? preferences.defaultModelId,
  };
  let nextRunAt: Date | null = null;
  try {
    nextRunAt = normalizedInput.enabled
      ? getAutomationNextRunAt(normalizedInput.triggers)
      : null;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid automation schedule",
      },
      { status: 400 },
    );
  }

  const automationId = await getAutomationId(context.params);
  const updatedAutomationId = await updateAutomationDefinition({
    automationId,
    userId: authResult.userId,
    input: normalizedInput,
    globalSkillRefs: preferences.globalSkillRefs,
    nextRunAt,
  });

  if (!updatedAutomationId) {
    return Response.json({ error: "Automation not found" }, { status: 404 });
  }

  const automation = await getAutomationById(updatedAutomationId);
  if (!automation) {
    return Response.json({ error: "Automation not found" }, { status: 404 });
  }

  kickAutomationSchedulerWorkflow({
    automationId: automation.id,
    replaceExisting: true,
  });

  return Response.json({ automation: serializeAutomation(automation) });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const automationId = await getAutomationId(context.params);
  const deleted = await deleteAutomationDefinition({
    automationId,
    userId: authResult.userId,
  });

  if (!deleted) {
    return Response.json({ error: "Automation not found" }, { status: 404 });
  }

  return Response.json({ success: true });
}
