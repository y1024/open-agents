import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getServerSession } from "@/lib/session/get-server-session";
import { needsOnboarding } from "@/lib/onboarding";
import { HomePage } from "./home-page";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Review recent runs and start new sessions in Open Agents.",
};

export default async function Home() {
  const session = await getServerSession();
  if (session?.user) {
    if (await needsOnboarding(session.user.id)) {
      redirect("/onboarding");
    }
    redirect("/sessions");
  }

  const store = await cookies();
  const hasSessionCookie = Boolean(store.get(SESSION_COOKIE_NAME)?.value);

  return <HomePage hasSessionCookie={hasSessionCookie} lastRepo={null} />;
}
