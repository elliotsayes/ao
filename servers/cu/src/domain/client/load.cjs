const Module = require('./process.cjs')

const DEFAULT_GAS_LIMIT = 9_000_000_000_000_000;

/* eslint-enable */

/**
 * @typedef Tag
 * @property {string} name
 * @property {string} value
 */

/**
 * @typedef Message
 * @property {string} [Signature]
 * @property {string} Owner
 * @property {string} Target
 * @property {string} [Anchor]
 * @property {Tag[]} Tags
 * @property {DataItem} [Data]
 * @property {string} From
 * @property {string} [Forwarded-By]
 * @property {string} [Epoch]
 * @property {string} [Nonce]
 * @property {string} Block-Height
 * @property {string} Timestamp
 * @property {string} [Hash-Chain]
 * @property {boolean} Cron
 */

/**
 * @typedef Environment
 * @property {{id: string, owner: string, tags: Tag[]}} process
 */

/**
 * @typedef HandleResponse
 * @property {ArrayBuffer} Memory
 * @property {DataItem} Output
 * @property {Message[]} Messages
 * @property {Message[]} Spawns
 */

/**
 * @callback handleFunction
 * @param {ArrayBuffer | NULL} buffer
 * @param {Message} msg
 * @param {Environment} env
 * @returns {HandleResponse}
 */

/**
 * @param {ArrayBuffer} binary
 * @returns {Promise<handleFunction>}
 */
module.exports = async function (binary, limit) {
  const instance = await Module(binary, limit);

  /**
   * Expose gas on the module
   *
   * This is how we track the amount of ops this WASM module has used,
   * and also how we refill the gas on each invocation of the WASM.
   */
  // instance.gas = {
  //   limit: limit || DEFAULT_GAS_LIMIT,
  //   used: 0,
  //   use: (amount) => {
  //     instance.gas.used += amount;
  //   },
  //   refill: (amount) => {
  //     if (!amount) instance.gas.used = 0;
  //     else instance.gas.used = Math.max(instance.gas.used - amount, 0);
  //   },
  //   isEmpty: () => instance.gas.used > instance.gas.limit,
  // };

  /**
   * Since the module can be invoked multiple times, there isn't really
   * a good place to cleanup these listeners (since emscripten doesn't do it),
   * other than immediately.
   *
   * I don't really see where they are used, since CU implementations MUST
   * catch reject Promises from the WASM module, as part of evaluation.
   *
   * TODO: maybe a better way to do this
   *
   * So we immediately remove any listeners added by Module,
   * in order to prevent memory leaks
   */
  // instance.cleanupListeners();
  const doHandle = instance.cwrap("handle", "string", ["string", "string"]);

  return (buffer, msg, env) => {
    try {
      if (buffer) {
        if (instance.HEAPU8.byteLength < buffer.byteLength)
          instance.resizeHeap(buffer.byteLength);
        instance.HEAPU8.set(buffer);
      }
      // /**
      //  * Make sure to refill the gas tank for each invocation
      //  */
      // instance.gas.refill();
      const { ok, response } = JSON.parse(
        doHandle(JSON.stringify(msg), JSON.stringify(env))
      );
      if (!ok) throw response;

      return {
        Memory: instance.HEAPU8.slice(),
        Error: response.Error,
        Output: response.Output,
        Messages: response.Messages,
        Spawns: response.Spawns,
        GasUsed: 0, // instance.gas.used,
      };
    } finally {
      buffer = null;
    }
  };
};
