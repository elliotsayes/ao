import { randomBytes } from 'node:crypto'
import { Duplex } from 'node:stream'
import { createWriteStream, createReadStream, unlink } from 'node:fs'
import { promisify } from 'node:util'

import { fromPromise, of, Rejected, Resolved } from 'hyper-async'
import { always, applySpec, last, prop } from 'ramda'
import { z } from 'zod'
import MultiStream from 'multistream'

import { moduleSchema } from '../model.js'

const moduleDocSchema = z.object({
  _id: z.string().min(1),
  moduleId: moduleSchema.shape.id,
  tags: moduleSchema.shape.tags,
  owner: moduleSchema.shape.owner,
  type: z.literal('module')
})

function createModuleId ({ moduleId }) {
  /**
   * transactions can sometimes start with an underscore,
   * which is not allowed in PouchDB, so prepend to create
   * an _id
   */
  return `module-${moduleId}`
}

export function saveModuleWith ({ pouchDb, logger: _logger }) {
  const logger = _logger.child('ao-module:saveModule')

  return (module) => {
    return of(module)
      .chain(fromPromise(async (module) =>
        applySpec({
          _id: (module) => createModuleId({ moduleId: module.id }),
          moduleId: prop('id'),
          tags: prop('tags'),
          owner: prop('owner'),
          type: always('module')
        })(module)
      ))
      /**
       * Ensure the expected shape before writing to the db
       */
      .map(moduleDocSchema.parse)
      .map((moduleDoc) => {
        logger('Creating module doc for module "%s"', module.id)
        return moduleDoc
      })
      .chain((doc) =>
        of(doc)
          .chain(fromPromise((doc) => pouchDb.put(doc)))
          .bichain(
            (err) => {
              /**
               * Already exists, so just return the doc
               */
              if (err.status === 409) return Resolved(doc)
              return Rejected(err)
            },
            Resolved
          )
          .map(always(doc._id))
      )
      .toPromise()
  }
}

export function findModuleWith ({ pouchDb }) {
  return ({ moduleId }) => {
    return of({ moduleId })
      .chain(fromPromise(() => pouchDb.get(createModuleId({ moduleId }))))
      .bichain(
        (err) => {
          if (err.status === 404) return Rejected({ status: 404, message: 'Module not found' })
          return Rejected(err)
        },
        (found) => of(found)
          /**
           * Ensure the input matches the expected
           * shape
           */
          .map(moduleDocSchema.parse)
          .map(applySpec({
            id: prop('moduleId'),
            tags: prop('tags'),
            owner: prop('owner')
          }))
      )
      .toPromise()
  }
}

export function evaluatorWith ({ evaluate }) {
  const unlinkP = promisify(unlink)
  class EvaluationStream extends Duplex {
    constructor (options) {
      super({ ...options, objectMode: true })

      this.maxFileSize = 16_000 // ~16kb

      this.cleanup = options.cleanup

      this.memPath = options.memPath
      this.streamId = options.streamId

      this.curWriteStream = null
      this.nextMessagesFile()
      this.pendingBatch = Promise.resolve({ memPath: options.memPath })

      /**
       * Files that will receive values written
       * to this Duplex
       */
      this.messagesFiles = []
      this.messagesIdx = 0

      /**
       * Files that will receive values eventually read
       * from this Duplex
       */
      this.resultsFiles = []
      this.resultIdx = 0

      this.resultsStream = new MultiStream(async (cb) => {
        /**
         * wait until either writing has ended, in which case, we allow
         * the streams to all drain consecutively,
         *
         * OR we wait until another resultsFile is pushed onto our list
         * before emitting the next read stream to concat
         */
        while (!this.ended && this.resultIdx >= this.resultsFiles.length) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        this.resultIdx++
        /**
         * No streams left and no more will be emitted
         */
        if (this.resultIdx >= this.resultsFiles.length) cb(null, null)

        /**
         * emit the next file stream to concat
         */
        else cb(null, createReadStream(this.resultsFiles[this.resultIdx]))
      })
    }

    nextMessagesFile () {
      this.messagesFiles.push(`${this.streamId}-${this.messagesFiles.length}.txt`)
      this.curWriteStream = createWriteStream(last(this.messagesFiles))
    }

    _write (msg, _enc, cb) {
      new Promise((resolve, reject) => {
        this.curWriteStream.write(JSON.stringify(msg), (err) => err
          ? reject(err)
          : resolve()
        )
      }).then(() => {
        /**
         * We've written the limit to the current value, so we need
         * to invoke an evaluation.
         *
         * Close the current stream, wait for the previous eval to complete
         * then start a new one using this next messagesFile and the memory
         * from the previous evaluation
         */
        if (this.curWriteStream.bytesWritten >= this.maxFileSize) {
          this.nextMessagesFile()

          /**
           * If an error occurs during evalation of the batch, then ensure
           * we set error, so it's passed via the callback to notify the stream
           * pipeline
           */
          this._evaluate().catch(cb)
        /**
         * No work to do yet, so just callback
         */
        } else cb()
      })
    }

    /**
     * Simply drain our results stream as fast as it is being read
     */
    _read () {
      this._drained = true
      if (this._forwarding || !this._drained) return

      this._forwarding = true
      let chunk
      while (this._drained && (chunk = this.resultsStream.read()) !== null) {
        this._drained = this.push(JSON.parse(chunk))
      }
      this._forwarding = false
    }

    async _final (cb) {
      while (this.messagesIdx < this.messagesFiles.length) await this.evaluate()

      if (this.cleanup) {
        /**
         * Delete any files created by this evaluation stream
         */
        await Promise.all(
          [this.messagesFiles, this.resultsFiles]
            .flat()
            .map(unlinkP)
        )
      }

      this.ended = true
      cb()
    }

    _destroy (err) {
      if (!err) return
      this.resultsStream.destroy(err)
    }

    _evaluate () {
      /**
       * Always wait for the current batch to finish processing,
       * so we can use the memory to continue folding over during evaluation
       */
      this.pendingBatch = this.pendingBatch
        .then(({ memPath }) => {
          const cur = this.messagesFiles[this.messagesIdx]

          return Promise.resolve(cur.closed)
            .then((closed) => closed
              ? Promise.resolve()
              : new Promise((resolve, reject) => cur.close((err) => err ? reject(err) : resolve()))
            )
            .then(() =>
              evaluate({
                memPath,
                /**
                 * post-increment the messagesIdx to keep track of where
                 * we are in evaluation
                 */
                messagesPath: this.messagesFiles[this.messagesIdx++]
              })
            )
        })

      return this.pendingBatch
    }
  }

  return ({ moduleId, gas, memLimit }) => of({ moduleId, gas, memLimit })
    /**
     * Create an evaluator function scoped to this particular
     * stream of messages
     */
    .map(() => {
      const streamId = randomBytes(8).toString('hex')

      /**
       * @type {EvaluationStream}
       */
      let evalStream
      return ({ name, processId, Memory, message, AoGlobal }) => {
        if (!evalStream) evalStream = new EvaluationStream({ streamId, memPath: Memory, cleanup: false })
        evalStream.write({ name, processId, message, AoGlobal })
      }
    })
    .toPromise()
}
