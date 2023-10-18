import { execSync } from 'child_process';
import { Rejected, fromPromise, of, Resolved } from 'hyper-async';
import NodeBundlr from '@bundlr-network/client/build/esm/node/bundlr';
import { createContract, createDataItemSigner } from '@permaweb/ao-sdk';
import { readFileSync } from 'fs';
globalThis.MU_URL = 'http://localhost:3004';
globalThis.CU_URL = 'http://localhost:3005';

// run ao build
async function main () {
  if (!process.env.PATH_TO_WALLET) {
    console.error('Set PATH_TO_WALLET to your keyfile to run this script.')
    process.exit()
  }
  const jwk = JSON.parse(readFileSync(process.env.PATH_TO_WALLET, 'utf-8'))
  const signer = () => createDataItemSigner(jwk)
  const bundlr = new NodeBundlr('https://node2.bundlr.network', 'arweave', jwk)
  return of(undefined)
    .chain(() => fromPromise(build)())
    .chain(() => fromPromise(publish)({ bundlr }))
    .chain(fromPromise(waitForOneSecond))
    .chain(({ tx }) =>
      fromPromise(create)({
        signer,
        srcTx: tx,
        extraState: {}
      })
    )
    .map(startApp)
    .fork(
      (e) => {
        console.error(e)
        process.exit()
      },
      (input) => {
        console.log('Success')
        console.log(input)
      }
    )
}

async function build () {
  try {
    execSync('(ao build)')
    return Resolved()
  } catch (error) {
    return Rejected(`Error executing command: ${error}`)
  }
}

/**
 * @typedef {Object} PublishInput
 * @property {NodeBundlr} bundlr - bundlr module.
 *
 * @author @jshaw-ar
 * @param {PublishInput} options
 * @return {*}
 */
async function publish ({ bundlr }) {
  // Upload with bundlr
  const tags = [
    {
      name: 'Content-Type',
      value: 'application/wasm',
    },
    {
      name: 'App-Name',
      value: 'SmartWeaveContractSource',
    },
    {
      name: 'App-Version',
      value: '0.4.0',
    },
    {
      name: 'Content-Type',
      value: 'application/wasm',
    },
    {
      name: 'Contract-Type',
      value: 'ao',
    }
  ];

  const response = await bundlr.uploadFile('./contract.wasm', {
    tags
  })

  return {
    tx: response.id
  };
}

async function create ({ srcTx, extraState, signer }) {
  const state = JSON.parse(readFileSync('./state.json', 'utf-8'))
  const newExtraState = extraState || {}
  const newState = {
    ...state,
    ...newExtraState
  };
  const result = await createContract({
    srcId: srcTx,
    initialState: newState,
    signer: signer(),
    tags: []
  })
  return { tx: result }
}

function startApp ({ tx }) {
  console.log(`Local token: http://localhost:3005/contract/${tx}`)
  execSync(`(cd app && VITE_PROCESS_ID=${tx} npx vite --mode production)`, {
    encoding: 'utf8',
    stdio: 'inherit',
  })
  return { tx }
}

async function waitForOneSecond (input) {
  const num = 2
  console.log(`Waiting ${num} second(s).`)
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(input)
    }, num * 1000) // 1000 milliseconds = 1 second
  })
}

main()
