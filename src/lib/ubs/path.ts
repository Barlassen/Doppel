/**
 * The light part of the life-path helpers (no data tables), so the dashboard can show and clear an applied path
 * without bundling the starter kit's assumption tables. `alexia.ts` builds the paths.
 */
import type { Scenario } from "@/lib/finance/types";
import type { Msg } from "@/lib/i18n/types";

export type AlexiaPathId = "work" | "master" | "abroad";
/** Order of `scenario_config.json`. */
export const ALEXIA_PATH_IDS: readonly AlexiaPathId[] = ["work", "master", "abroad"];
export const pathLabel = (id: AlexiaPathId): Msg => ({ key: `ubs.path.${id}` });
/** Id prefix of the one-off costs a path adds as dated expenses. */
export const PATH_EVENT = "ubs-path-";

/** Removes an applied path (phases, its one-off costs and its pill). */
export function clearPath(s: Scenario): Scenario {
  const { phases: _phases, path: _path, ...rest } = s;
  void _phases;
  void _path;
  return { ...rest, events: s.events.filter((e) => !e.id.startsWith(PATH_EVENT)) };
}
