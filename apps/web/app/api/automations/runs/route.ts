import {
  listAutomationRunsByUserId,
  listAutomationsByUserId,
} from "@/lib/db/automations";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const [runs, automations] = await Promise.all([
    listAutomationRunsByUserId(authResult.userId, 50),
    listAutomationsByUserId(authResult.userId, { includeDeleted: true }),
  ]);

  const automationInfo = new Map(
    automations.map((a) => [
      a.id,
      {
        name: a.name,
        enabled: a.enabled,
        deleted: a.deletedAt !== null,
      },
    ]),
  );

  return Response.json({
    runs: runs.map((run) => {
      const info = automationInfo.get(run.automationId);
      return {
        ...run,
        automationName: info?.name ?? "Unknown",
        automationEnabled: info?.enabled ?? false,
        automationDeleted: info?.deleted ?? false,
      };
    }),
  });
}
