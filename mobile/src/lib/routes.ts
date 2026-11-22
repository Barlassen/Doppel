/** The two destinations of the bottom bar and how they map to paths of the web app. Pure. */

export type Route = "dashboard" | "play";

export const ROUTE_PATHS: Record<Route, string> = { dashboard: "/", play: "/play" };

/** Which destination a path of the web app belongs to. Everything outside `/play` is the dashboard. */
export function routeForPath(path: string): Route {
  const clean = (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  return clean === "/play" || clean.startsWith("/play/") ? "play" : "dashboard";
}

export function urlForRoute(serverUrl: string, route: Route): string {
  return `${serverUrl}${ROUTE_PATHS[route]}`;
}
