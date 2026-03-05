import { cookies } from "next/headers";
import { createTeamForUser, listTeamsForUser } from "@/lib/db/teams";
import { encryptJWE } from "@/lib/jwe/encrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreateTeamRequest {
  name?: string;
  switchToTeam?: boolean;
}

const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_TEAM_NAME_LENGTH = 80;

function normalizeTeamName(rawName: string | undefined): string | null {
  const trimmedName = rawName?.trim();
  if (!trimmedName) {
    return null;
  }

  if (trimmedName.length > MAX_TEAM_NAME_LENGTH) {
    return null;
  }

  return trimmedName;
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CreateTeamRequest;
  try {
    body = (await req.json()) as CreateTeamRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teamName = normalizeTeamName(body.name);
  if (!teamName) {
    return Response.json(
      {
        error: `Team name is required and must be at most ${MAX_TEAM_NAME_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  const createdTeam = await createTeamForUser({
    ownerUserId: session.user.id,
    name: teamName,
  });

  const shouldSwitchToTeam = body.switchToTeam ?? true;
  const nextActiveTeamId = shouldSwitchToTeam
    ? createdTeam.id
    : (session.activeTeamId ?? createdTeam.id);

  if (nextActiveTeamId !== session.activeTeamId) {
    const sessionToken = await encryptJWE(
      {
        ...session,
        activeTeamId: nextActiveTeamId,
      },
      "1y",
    );

    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, sessionToken, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  const teams = await listTeamsForUser(session.user.id);

  return Response.json({
    team: {
      id: createdTeam.id,
      name: createdTeam.name,
      role: "owner",
      isPersonal: false,
    },
    activeTeamId: nextActiveTeamId,
    teams,
  });
}
