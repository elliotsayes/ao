/* eslint-disable no-throw-literal */
import { describe, test, before, beforeEach } from 'node:test'
import assert from 'node:assert'
import { createReadStream } from 'node:fs'

import { LRUCache } from 'lru-cache'
import AoLoader from '@permaweb/ao-loader'

import { createLogger } from '../logger.js'

const logger = createLogger('ao-cu:worker')

describe('worker', async () => {
  process.env.NO_WORKER = '1'

  describe('evaluateWith', async () => {
    describe('output', async () => {
      let evaluate
      let eject
      const wasmInstanceCache = new LRUCache({ max: 1 })
      const wasmMemoryCache = new Map()
      before(async () => {
        const worker = await import('./worker.js')
        evaluate = worker.evaluateWith({
          wasmMemoryCache,
          wasmInstanceCache,
          wasmModuleCache: new LRUCache({ max: 1 }),
          readWasmFile: async () => createReadStream('./test/processes/happy/process.wasm'),
          writeWasmFile: async () => true,
          streamTransactionData: async () => assert.fail('should not call if readWasmFile'),
          bootstrapWasmInstance: (wasmModule, gas, memLimit) => AoLoader((info, receiveInstance) => {
            assert.equal(gas, args.gas)
            assert.equal(memLimit, args.memLimit)
            return WebAssembly.instantiate(wasmModule, info).then(receiveInstance)
          }),
          logger
        })

        eject = worker.ejectWith({ wasmMemoryCache })
      })

      beforeEach(async () => {
        wasmInstanceCache.clear()
        await eject('stream-123')
      })

      const args = {
        streamId: 'stream-123',
        moduleId: 'module-123',
        gas: 9_000_000_000_000,
        memLimit: 9_000_000_000_000,
        name: 'message 123',
        processId: 'process-123',
        message: {
          Id: 'message-123',
          Timestamp: 1702846520559,
          Owner: 'owner-123',
          Tags: [
            { name: 'function', value: 'hello' }
          ],
          'Block-Height': 1234
        },
        AoGlobal: {
          Process: {
            Id: '1234',
            Tags: []
          }
        }
      }

      test('caches the memory', async () => {
        await evaluate(args)
        assert.ok(wasmMemoryCache.get('stream-123'))
      })

      test('returns messages', async () => {
        const expectedMessage = {
          Target: 'process-foo-123',
          Tags: [
            { name: 'foo', value: 'bar' },
            { name: 'function', value: 'noop' }
          ]
        }
        const output = await evaluate(args)
        assert.deepStrictEqual(output.Messages, [expectedMessage])
      })

      test('returns spawns', async () => {
        const expectedSpawn = {
          Owner: 'owner-123',
          Tags: [
            { name: 'foo', value: 'bar' },
            { name: 'balances', value: '{"myOVEwyX7QKFaPkXo3Wlib-Q80MOf5xyjL9ZyvYSVYc": 1000 }' }
          ]
        }
        const output = await evaluate(args)
        assert.deepStrictEqual(output.Spawns, [expectedSpawn])
      })

      test('returns output', async () => {
        const output = await evaluate(args)
        assert.deepEqual(JSON.parse(output.Output), {
          heardHello: true,
          lastMessage: {
            Id: 'message-123',
            Timestamp: 1702846520559,
            Owner: 'owner-123',
            Tags: [
              { name: 'function', value: 'hello' }
            ],
            'Block-Height': 1234,
            function: 'hello'
          }
        })
      })

      test('folds state across multiple invocations', async () => {
        await evaluate(args)
        const output = await evaluate({
          ...args,
          message: {
            Id: 'message-123',
            Timestamp: 1702846520559,
            Owner: 'owner-456',
            Tags: [
              { name: 'function', value: 'world' }
            ],
            'Block-Height': 1235
          }
        })

        assert.deepEqual(
          /**
           * Our process used in the unit tests serializes the state being mutated
           * by the process, so we can parse it here and run assertions
           */
          JSON.parse(output.Output),
          {
            heardHello: true,
            heardWorld: true,
            happy: true,
            lastMessage: {
              Id: 'message-123',
              Timestamp: 1702846520559,
              Owner: 'owner-456',
              Tags: [
                { name: 'function', value: 'world' }
              ],
              'Block-Height': 1235,
              function: 'world'
            }
          }
        )
      })
    })

    describe('errors', async () => {
      let evaluate
      let prime
      const wasmMemoryCache = new Map()
      before(async () => {
        const worker = await import('./worker.js')
        evaluate = worker.evaluateWith({
          wasmMemoryCache,
          wasmInstanceCache: new LRUCache({ max: 1 }),
          wasmModuleCache: new LRUCache({ max: 1 }),
          readWasmFile: async () => createReadStream('./test/processes/sad/process.wasm'),
          writeWasmFile: async () => true,
          streamTransactionData: async () => assert.fail('should not call if readWasmFile'),
          bootstrapWasmInstance: (wasmModule) => AoLoader((info, receiveInstance) =>
            WebAssembly.instantiate(wasmModule, info).then(receiveInstance)
          ),
          logger
        })

        prime = worker.primeWith({ wasmMemoryCache })
      })

      beforeEach(async () => prime('stream-123', Buffer.from('Hello', 'utf-8')))

      const args = {
        streamId: 'stream-123',
        moduleId: 'module-123',
        gas: 9_000_000_000_000,
        memLimit: 9_000_000_000_000,
        name: 'message 123',
        processId: 'process-123',
        // Will add message in each test case
        AoGlobal: {
          Process: {
            Id: '1234',
            Tags: []
          }
        }
      }

      test('error returned in process result and uses previous Memory', async () => {
        const output = await evaluate({
          ...args,
          message: {
            Id: 'message-123',
            Timestamp: 1702846520559,
            Owner: 'owner-456',
            Tags: [
              { name: 'function', value: 'errorResult' }
            ],
            'Block-Height': 1234
          }
        })

        /**
         * When an error occurs in eval, its output Memory is ignored
         * and the output Memory from the previous eval is used.
         *
         * So we assert that the original Memory that was passed in is returned
         * from eval
         */
        assert.deepStrictEqual(wasmMemoryCache.get('stream-123'), Buffer.from('Hello', 'utf-8'))
        assert.deepStrictEqual(output.Error, { code: 123, message: 'a handled error within the process' })
      })

      test('error thrown by process and uses previous Memory', async () => {
        const output = await evaluate({
          ...args,
          message: {
            Id: 'message-123',
            Timestamp: 1702846520559,
            Owner: 'owner-456',
            Tags: [
              { name: 'function', value: 'errorThrow' }
            ],
            'Block-Height': 1234
          }
        })

        assert.deepStrictEqual(wasmMemoryCache.get('stream-123'), Buffer.from('Hello', 'utf-8'))
        assert.deepStrictEqual(output.Error, { code: 123, message: 'a thrown error within the process' })
      })

      test('error unhandled by process and uses previous Memory', async () => {
        const output = await evaluate({
          ...args,
          // Will unintentionally throw from the lua
          message: {
            Id: 'message-123',
            Timestamp: 1702846520559,
            Owner: 'owner-456',
            Tags: [
              { name: 'function', value: 'errorUnhandled' }
            ],
            'Block-Height': 1234
          }
        })

        assert.ok(output.Error)
        assert(output.Error.endsWith("attempt to index a nil value (field 'field')"))
        assert.deepStrictEqual(wasmMemoryCache.get('stream-123'), Buffer.from('Hello', 'utf-8'))
      })
    })
  })
})
