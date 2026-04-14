import { filterManagedTemplateTrialRestrictedModels } from "@/lib/managed-template-trial";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";
import { getServerSession } from "@/lib/session/get-server-session";

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(req: Request) {
  try {
    const [models, session] = await Promise.all([
      fetchAvailableLanguageModelsWithContext(),
      getServerSession(),
    ]);

    return Response.json(
      {
        models: filterManagedTemplateTrialRestrictedModels(
          models,
          session,
          req.url,
        ),
      },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch available models:", error);
    return Response.json(
      { error: "Failed to fetch available models" },
      { status: 500 },
    );
  }
}
