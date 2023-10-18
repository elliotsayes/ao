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

  useEffect(() => {
    readState({
      contractId: import.meta.env.VITE_PROCESS_ID,
    })
      .then(setProcessState)
      .catch((e) => console.log(e));
  }, []);

  return (
    <>
      <h1>Process TX: {import.meta.env.VITE_PROCESS_ID}</h1>
      <h1
        onClick={() => goToPlayer("<player name>")}
        className="text-3xl font-bold underline"
      >
        Process State:
      </h1>
      <p>{JSON.stringify(processState)}</p>

      <div>
        <button
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

        {interactionId && <h3>Ineraction ID: {interactionId}</h3>}
      </div>
    </>
  );
}

export default connect(mapStateToProps, router)(Feed);
