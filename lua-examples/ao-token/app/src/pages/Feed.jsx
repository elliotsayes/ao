import { connect } from "react-redux";
import { mapStateToProps, router } from "../store/router";
import {
  readState,
  writeInteraction,
  createDataItemSigner,
} from "@permaweb/ao-sdk";
import { useEffect, useState } from "react";

function Feed({ goToPlayer }) {
  const signer = createDataItemSigner(globalThis.arweaveWallet);
  const [interactionId, setInteractionId] = useState();
  const [processState, setProcessState] = useState();
  const [amount, setAmount] = useState(0);
  const [recipient, setRecipient] = useState("");

  useEffect(() => {
    readState({
      contractId: import.meta.env.VITE_PROCESS_ID,
    })
      .then(setProcessState)
      .catch((e) => console.log(e));
  }, [interactionId]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">
        Process TX: {import.meta.env.VITE_PROCESS_ID}
      </h1>
      <h1
        onClick={() => goToPlayer("<player name>")}
        className="text-3xl font-bold underline cursor-pointer mb-4"
      >
        Process State:
      </h1>
      <p>{JSON.stringify(processState)}</p>

      <div className="mb-4">
        <label className="block mb-2">
          Amount:
          <input
            className="border border-gray-300 p-2 w-full"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="block mb-2">
          Recipient:
          <input
            className="border border-gray-300 p-2 w-full"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>

        <button
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-700"
          onClick={async () => {
            if (globalThis.arweaveWallet) {
              await globalThis.arweaveWallet.connect(["SIGN_TRANSACTION"]);
            }
            const interactionId = await writeInteraction({
              contractId: import.meta.env.VITE_PROCESS_ID,
              input: {
                function: "transfer",
                target: recipient,
                qty: Math.floor(amount * 1e6),
              },
              signer,
              tags: [],
            });
            setInteractionId(interactionId);
          }}
        >
          Transfer
        </button>
      </div>

      <div>
        <button
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-700"
          onClick={async () => {
            if (globalThis.arweaveWallet) {
              await globalThis.arweaveWallet.connect(["SIGN_TRANSACTION"]);
            }
            const interactionId = await writeInteraction({
              contractId: import.meta.env.VITE_PROCESS_ID,
              input: { function: "mint" },
              signer,
              tags: [],
            });
            setInteractionId(interactionId);
          }}
        >
          Mint 1
        </button>

        {interactionId && (
          <h3 className="mt-4">Interaction ID: {interactionId}</h3>
        )}
      </div>
    </div>
  );
}

export default connect(mapStateToProps, router)(Feed);
