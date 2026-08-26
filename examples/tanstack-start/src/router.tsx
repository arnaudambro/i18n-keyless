import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// The TanStack Start plugin calls this to build the router on both the server and the
// client, so the two sides always share one configuration.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
