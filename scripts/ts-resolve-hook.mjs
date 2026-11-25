import fs from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../'))
      && !path.extname(specifier)
      && context.parentURL?.startsWith('file://')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL))
      const candidateFile = path.resolve(parentDir, `${specifier}.ts`)
      if (fs.existsSync(candidateFile)) {
        return nextResolve(pathToFileURL(candidateFile).href, context)
      }

      const candidateIndex = path.resolve(parentDir, specifier, 'index.ts')
      if (fs.existsSync(candidateIndex)) {
        return nextResolve(pathToFileURL(candidateIndex).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})
