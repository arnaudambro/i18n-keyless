import { createFileRoute } from "@tanstack/react-router";
import { HomeContent } from "../components/HomeContent";

export const Route = createFileRoute("/")({
  component: HomeContent,
});
