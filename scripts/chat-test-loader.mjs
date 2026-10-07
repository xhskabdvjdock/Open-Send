// Local-only ESM hook for chat tests: resolves extensionless relative imports
// (./paths -> ./paths.ts) the way Next/webpack does. Test tooling only.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        if (existsSync(base + ext)) {
          return { url: pathToFileURL(base + ext).href, shortCircuit: true };
        }
      }
    }
    throw err;
  }
}
