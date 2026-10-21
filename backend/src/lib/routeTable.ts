import type { Express, Router } from "express";

/**
 * Express 5 does not keep a mounted router's path as a string, so routers are
 * mounted through mountRouter(), which records it. listRoutes() then walks the
 * real middleware stack. The security and OpenAPI tests use it to check every
 * registered route, so a new route cannot slip in unprotected or undocumented.
 */
const mountPaths = new WeakMap<object, string>();

export function mountRouter(parent: Pick<Router, "use">, path: string, router: Router): void {
  mountPaths.set(router, path);
  parent.use(path, router);
}

export interface RouteInfo {
  method: string; // upper case
  path: string; // Express syntax, e.g. /api/v1/tickets/:id
}

interface StackLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: StackLayer[] };
}

export function listRoutes(app: Express): RouteInfo[] {
  return walk((app as unknown as { router: { stack: StackLayer[] } }).router.stack, "");
}

function walk(stack: StackLayer[], prefix: string): RouteInfo[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      return Object.keys(layer.route.methods)
        .filter((m) => m !== "_all")
        .map((m) => ({ method: m.toUpperCase(), path: prefix + layer.route!.path }));
    }
    if (layer.handle.stack) {
      const mount = mountPaths.get(layer.handle);
      if (mount === undefined) throw new Error("Nested router mounted without mountRouter(); its routes cannot be listed");
      return walk(layer.handle.stack, prefix + mount);
    }
    return []; // plain middleware
  });
}
