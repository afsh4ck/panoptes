import fs from 'node:fs';
import path from 'node:path';

/**
 * Loader for a shipped `{cameras: {id: entry}}` sidecar (ground heights, road
 * bearings), cached by file mtime so a catalog refresh re-reads only when the
 * file changed. `envName` overrides the path. Missing or malformed files mean
 * "nothing shipped", never an error.
 *
 * @param {{envName: string, defaultFile: string}} options
 * @returns {(sourceRoot?: string) => Record<string, object>}
 */
export function createSidecarLoader({ envName, defaultFile }) {
  /** @type {{path:string, mtimeMs:number, cameras:object}|null} */
  let cache = null;
  return function loadSidecar(sourceRoot = process.cwd()) {
    const file = process.env[envName] || defaultFile;
    const resolved = path.isAbsolute(file)
      ? file
      : path.resolve(sourceRoot, file);
    try {
      const stat = fs.statSync(resolved);
      if (cache && cache.path === resolved && cache.mtimeMs === stat.mtimeMs) {
        return cache.cameras;
      }
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      const cameras =
        parsed &&
        typeof parsed === 'object' &&
        parsed.cameras &&
        typeof parsed.cameras === 'object'
          ? parsed.cameras
          : {};
      cache = { path: resolved, mtimeMs: stat.mtimeMs, cameras };
      return cameras;
    } catch {
      cache = null;
      return {};
    }
  };
}
