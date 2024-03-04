import { workerData } from 'node:worker_threads'
import { Readable, pipeline } from 'node:stream'
import { createReadStream, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { createGunzip, createGzip } from 'node:zlib'
import { promisify } from 'node:util'
import { hostname } from 'node:os'

import { worker } from 'workerpool'
import { T, always, applySpec, assocPath, cond, defaultTo, identity, ifElse, is, omit, pathOr, pipe, propOr } from 'ramda'
import { LRUCache } from 'lru-cache'
import { Rejected, Resolved, fromPromise, of } from 'hyper-async'
import AoLoader from '@permaweb/ao-loader'

import { createLogger } from '../logger.js'

const pipelineP = promisify(pipeline)

function wasmResponse (stream) {
  return new Response(stream, { headers: { 'Content-Type': 'application/wasm' } })
}

/**
 * ###################
 * File Utils
 * ###################
 */

function readWasmFileWith ({ DIR }) {
  return async (moduleId) => {
    const file = join(DIR, `${moduleId}.wasm.gz`)

    return new Promise((resolve, reject) =>
      resolve(pipeline(
        createReadStream(file),
        createGunzip(),
        reject
      ))
    )
  }
}

function writeWasmFileWith ({ DIR, logger }) {
  return async (moduleId, wasmStream) => {
    const file = join(DIR, `${moduleId}.wasm.gz`)

    return pipelineP(
      wasmStream,
      createGzip(),
      createWriteStream(file)
    ).catch((err) => {
      logger('Failed to cache binary for module "%s" in a file. Skipping...', moduleId, err)
    })
  }
}

/**
 * #######################
 * Network Utils
 * #######################
 */

function streamTransactionDataWith ({ fetch, GATEWAY_URL, logger }) {
  return (id) =>
    of(id)
      .chain(fromPromise((id) =>
        fetch(`${GATEWAY_URL}/raw/${id}`)
          .then(async (res) => {
            if (res.ok) return res
            logger(
              'Error Encountered when fetching raw data for transaction \'%s\' from gateway \'%s\'',
              id,
              GATEWAY_URL
            )
            throw new Error(`${res.status}: ${await res.text()}`)
          })
      ))
      .toPromise()
}

/**
 * ##############################
 * #### LRU In-Memory Cache utils
 * ##############################
 */

/**
 * A cache for compiled Wasm Modules
 *
 * @returns {LRUCache<string, WebAssembly.Module>}
 */
function createWasmModuleCache ({ MAX_SIZE }) {
  return new LRUCache({
    /**
     * #######################
     * Capacity Configuration
     * #######################
     */
    max: MAX_SIZE
  })
}

/**
 * A cache for loaded wasm modules,
 * as part of evaluating a stream of messages
 *
 * @returns {LRUCache<string, Function>}
 */
function createWasmInstanceCache ({ MAX_SIZE }) {
  return new LRUCache({
    /**
     * #######################
     * Capacity Configuration
     * #######################
     */
    max: MAX_SIZE
  })
}

function createWasmMemoryCache () {
  return new Map()
}

export function primeWith ({ wasmMemoryCache }) {
  return async (streamId, memory) => wasmMemoryCache.set(streamId, memory)
}

export function ejectWith ({ wasmMemoryCache }) {
  return async (streamId) => {
    const memory = wasmMemoryCache.get(streamId)
    wasmMemoryCache.delete(streamId)
    return memory
  }
}

export function evaluateWith ({
  wasmMemoryCache,
  wasmInstanceCache,
  wasmModuleCache,
  readWasmFile,
  writeWasmFile,
  streamTransactionData,
  bootstrapWasmInstance,
  logger
}) {
  function loadTransaction ({ moduleId }) {
    logger('Loading wasm transaction "%s"...', moduleId)

    return of(moduleId)
      .chain(fromPromise(streamTransactionData))
      .map((res) => res.body.tee())
      /**
       * Simoultaneously cache the binary in a file
       * and compile to a WebAssembly.Module
       */
      .chain(fromPromise(([s1, s2]) =>
        Promise.all([
          writeWasmFile(moduleId, Readable.fromWeb(s1)),
          WebAssembly.compileStreaming(wasmResponse(s2))
        ])
      ))
      .map(([, res]) => res)
  }

  function maybeStoredBinary ({ streamId, moduleId, gas, memLimit, message, AoGlobal }) {
    logger('Checking for wasm file to load module "%s"...', moduleId)

    return of(moduleId)
      .chain(fromPromise(readWasmFile))
      .chain(fromPromise((stream) =>
        /**
         * Compile the binary from the file into a WebAssembly.Module
         */
        WebAssembly.compileStreaming(wasmResponse(Readable.toWeb(stream)))
      ))
      .bimap(
        () => ({ streamId, moduleId, gas, memLimit, message, AoGlobal }),
        identity
      )
  }

  function maybeCachedModule ({ streamId, moduleId, gas, memLimit, message, AoGlobal }) {
    return of(moduleId)
      .map((moduleId) => wasmModuleCache.get(moduleId))
      .chain((wasm) => wasm
        ? Resolved(wasm)
        : Rejected({ streamId, moduleId, gas, memLimit, message, AoGlobal })
      )
  }

  function loadInstance ({ streamId, moduleId, gas, memLimit, message, AoGlobal }) {
    /**
     * First check if the Module is cached already in-memory
     */
    return maybeCachedModule({ streamId, moduleId, gas, memLimit, message, AoGlobal })
      .bichain(
        /**
         * Check if the binary is cached in a file, and fallback to Arweave,
         * backfilling caching layers as needed
         */
        () => of({ streamId, moduleId, gas, memLimit, message, AoGlobal })
          .chain(maybeStoredBinary)
          .bichain(loadTransaction, Resolved)
          /**
           * Cache the wasm Module in memory for quick access next time
           */
          .map((wasmModule) => {
            logger('Caching compiled WebAssembly.Module for module "%s" in memory, for next time...', moduleId)
            wasmModuleCache.set(moduleId, wasmModule)
            return wasmModule
          }),
        /**
         * Cached instance, so just reuse
         */
        Resolved
      )
      .chain(fromPromise((wasmModule) => bootstrapWasmInstance(wasmModule, gas, memLimit)))
  }

  function maybeCachedInstance ({ streamId, moduleId, gas, memLimit, message, AoGlobal }) {
    return of(streamId)
      .map((streamId) => wasmInstanceCache.get(streamId))
      .chain((cached) => cached
        ? Resolved(cached)
        : Rejected({ streamId, moduleId, gas, memLimit, message, AoGlobal })
      )
  }

  /**
   * Given the previous interaction output,
   * return a function that will merge the next interaction output
   * with the previous.
   */
  const mergeOutput = (prevMemory) => pipe(
    defaultTo({}),
    applySpec({
      /**
       * If the output contains an error, ignore its state,
       * and use the previous evaluation's state
       */
      Memory: ifElse(
        pathOr(undefined, ['Error']),
        always(prevMemory),
        propOr(prevMemory, 'Memory')
      ),
      Error: pathOr(undefined, ['Error']),
      Messages: pathOr([], ['Messages']),
      Spawns: pathOr([], ['Spawns']),
      Output: pipe(
        pathOr('', ['Output']),
        /**
         * Always make sure Output
         * is a string or object
         */
        cond([
          [is(String), identity],
          [is(Object), identity],
          [is(Number), String],
          [T, identity]
        ])
      ),
      GasUsed: pathOr(undefined, ['GasUsed'])
    })
  )

  /**
   * Evaluate a message using the handler that wraps the WebAssembly.Instance,
   * identified by the streamId.
   *
   * If not already instantiated and cached in memory, attempt to use a cached WebAssembly.Module
   * and instantiate the Instance and handler, caching it by streamId
   *
   * If the WebAssembly.Module is not cached, then we check if the binary is cached in a file,
   * then compile it in a WebAssembly.Module, cached in memory, then used to instantiate a
   * new WebAssembly.Instance
   *
   * If not in a file, then the module transaction is downloaded from the Gateway url,
   * cached in a file, compiled, further cached in memory, then used to instantiate a
   * new WebAssembly.Instance and handler
   *
   * Finally, evaluates the message and returns the result of the evaluation.
   */
  return ({ streamId, moduleId, gas, memLimit, name, processId, message, AoGlobal }) =>
    /**
     * Dynamically load the module, either from cache,
     * or from a file
     */
    maybeCachedInstance({ streamId, moduleId, gas, memLimit, name, processId, message, AoGlobal })
      .bichain(loadInstance, Resolved)
      /**
       * Perform the evaluation
       */
      .chain((wasmInstance) =>
        of(wasmInstance)
          .chain((wasmInstance) => {
            logger('Evaluating message "%s" to process "%s"', name, processId)
            /**
             * The memory is either cached from a previous evaluation in this evaluation stream
             * or from the main thread priming the cache with the memory it has retrieved,
             * either from it's own cache or from a Checkpoint on Arweave
             */
            const memory = wasmMemoryCache.get(streamId)

            return of(wasmInstance)
              .chain(fromPromise(async (wasmInstance) => wasmInstance(memory, message, AoGlobal)))
              .bichain(
                /**
                 * Map thrown error to a result.error. In this way, the Worker should _never_
                 * throw due to evaluation
                 *
                 * TODO: should we also evict the wasmInstance from cache, so it's reinstantaited
                 * with the new memory for next time?
                 */
                (err) => Resolved(assocPath(['Error'], err, {})),
                Resolved
              )
              .map(mergeOutput(memory))
              .map((res) => {
                wasmMemoryCache.set(streamId, res.Memory)
                /**
                 * Do not send memory back over the main thread interop
                 * as this causes a non-trivial performance impact due to serialization
                 * of the memory.
                 *
                 * Instead we cache it in the worker, and eject at the end of the eval stream
                 */
                return omit(['Memory'], res)
              })
          })
      )
      .toPromise()
}

if (!process.env.NO_WORKER) {
  const logger = createLogger(`ao-cu:${hostname()}:worker-${workerData.id}`)
  const wasmMemoryCache = createWasmMemoryCache()
  /**
   * Expose our worker api
   */
  worker({
    prime: primeWith({ wasmMemoryCache }),
    eject: ejectWith({ wasmMemoryCache }),
    evaluate: evaluateWith({
      wasmMemoryCache,
      wasmModuleCache: createWasmModuleCache({ MAX_SIZE: workerData.WASM_MODULE_CACHE_MAX_SIZE }),
      wasmInstanceCache: createWasmInstanceCache({ MAX_SIZE: workerData.WASM_INSTANCE_CACHE_MAX_SIZE }),
      readWasmFile: readWasmFileWith({ DIR: workerData.WASM_BINARY_FILE_DIRECTORY }),
      writeWasmFile: writeWasmFileWith({ DIR: workerData.WASM_BINARY_FILE_DIRECTORY, logger }),
      streamTransactionData: streamTransactionDataWith({ fetch, GATEWAY_URL: workerData.GATEWAY_URL, logger }),
      bootstrapWasmInstance: (wasmModule, gasLimit, memoryLimit) => AoLoader(
        (info, receiveInstance) => WebAssembly.instantiate(wasmModule, info).then(receiveInstance),
        gasLimit,
        memoryLimit
      ),
      logger
    })
  })
}
