import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Contracts and this Hardhat workspace live in separate top-level
// directories (../contracts and ./hardhat) rather than the Hardhat default
// of nesting contracts/ under the project — matches the rest of the repo
// layout (see README-BOURBON-PORT.md).
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // BottleRegistry.addBottle() takes enough parameters (mirroring the
      // full Bottle struct) that the legacy code generator hits "stack too
      // deep" without this. viaIR trades a slower compile for keeping the
      // explicit, self-documenting function signature instead of collapsing
      // it into an opaque struct/calldata blob.
      viaIR: true,
    },
  },
  // Hardhat requires everything under `paths.root`, so we point root at the
  // repo root (one level up) and give every path explicitly from there —
  // that's what lets contracts/ live as its own top-level directory instead
  // of nested inside hardhat/, matching the rest of this repo's layout.
  paths: {
    root: "..",
    sources: "contracts",
    tests: "hardhat/test",
    cache: "hardhat/cache",
    artifacts: "hardhat/artifacts",
  },
  networks: {
    // In-memory network used only for `npm test` — fast contract-logic
    // verification with throwaway Hardhat accounts. Never used for anything
    // that touches the real app identity.
    hardhat: {},

    // A local `besu --network=dev` or similar, for manual smoke testing
    // without going anywhere near AWS.
    localhost: {
      url: "http://127.0.0.1:8545",
    },

    // The real target: the private Besu QBFT network on AWS, reached
    // through Web3Signer rather than Besu's own RPC port. Web3Signer sits
    // in front of Besu and answers eth_accounts / eth_sendTransaction
    // itself (signing with the AWS KMS key), forwarding everything else
    // (eth_call, eth_getTransactionReceipt, ...) straight through to Besu.
    // Pointing Hardhat/ethers at Web3Signer's URL means `signer.sendTransaction`
    // "just works" with no private key ever touching this machine — see
    // api/src/chain/web3signer.ts for the equivalent flow done by hand
    // (explicit nonce/gas/receipt handling) rather than through ethers.
    besuQbft: {
      url: process.env.WEB3SIGNER_RPC_URL || "http://localhost:9000",
      // Besu QBFT networks in this project use a fixed, non-standard
      // chain ID so a signed tx can never accidentally replay against a
      // public network. Set to the real value from
      // QBFT-Network/genesis/genesis.json ("config.chainId") once the
      // network is generated.
      chainId: Number(process.env.BESU_CHAIN_ID || 190416),
      // No `accounts` field: Web3Signer exposes the KMS-derived address via
      // eth_accounts and Hardhat/ethers picks it up as an "unlocked"
      // account, same as it would for a node with an unlocked keystore.
    },
  },
};

export default config;
