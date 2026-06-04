import { createFileRoute } from "@tanstack/react-router";
import Landing from "@/pages/Landing";

export const Route = createFileRoute("/landing")({
  ssr: false,
  component: Landing,
});
