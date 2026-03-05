import { addUserToTeam, getTeamById, getTeamMembership } from "@/lib/db/teams";
import { getUserByUsername } from "@/lib/db/users";
import { getServerSession } from "@/lib/session/get-server-session";

interface InviteTeamMemberRequest {
  username?: string;
}

type RouteContext = {
  params: Promise<{ teamId: string }>;
};

function normalizeUsername(rawUsername: string | undefined): string | null {
  const trimmedUsername = rawUsername?.trim();
  return trimmedUsername ? trimmedUsername : null;
}

export async function POST(req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { teamId } = await context.params;
  if (!teamId.trim()) {
    return Response.json({ error: "Missing teamId" }, { status: 400 });
  }

  const [team, membership] = await Promise.all([
    getTeamById(teamId),
    getTeamMembership(session.user.id, teamId),
  ]);

  if (!team) {
    return Response.json({ error: "Team not found" }, { status: 404 });
  }

  if (!membership) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (membership.role !== "owner") {
    return Response.json(
      { error: "Only team owners can invite members" },
      { status: 403 },
    );
  }

  if (team.personalOwnerUserId) {
    return Response.json(
      { error: "Cannot invite members to a personal team" },
      { status: 400 },
    );
  }

  let body: InviteTeamMemberRequest;
  try {
    body = (await req.json()) as InviteTeamMemberRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = normalizeUsername(body.username);
  if (!username) {
    return Response.json({ error: "username is required" }, { status: 400 });
  }

  const targetUser = await getUserByUsername(username);
  if (!targetUser) {
    return Response.json(
      {
        error:
          "User not found. Ask them to sign in at least once before inviting.",
      },
      { status: 404 },
    );
  }

  if (targetUser.id === session.user.id) {
    return Response.json(
      { error: "You are already a member of this team" },
      { status: 400 },
    );
  }

  const result = await addUserToTeam({
    teamId,
    userId: targetUser.id,
    role: "member",
  });

  return Response.json({
    member: {
      userId: targetUser.id,
      username: targetUser.username,
      role: result.membership.role,
    },
    alreadyMember: !result.created,
  });
}
