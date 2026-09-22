import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Contracts and this Hardhat workspace live in separate directories
// (../contracts and ./hardhat) rather than Hardhat's default of nesting
// contracts/ under the project — matches the sibling bourbon-registry
// project's layout (see its README-BOURBON-PORT.md) and the rest of this
// repo.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // registerItem() takes enough string params that the legacy code
      // generator risks "stack too deep"; viaIR trades a slower compile for
      // keeping the explicit signature instead of collapsing it into an
      // opaque struct/calldata blob.
      viaIR: true,
    },
  },
  // Hardhat requires everything under `paths.root`; pointing root at this
  // app's own top-level directory (one level up) lets contracts/ live as
  // its own directory instead of nested inside hardhat/.
  paths: {
    root: "..",
    sources: "contracts",
    tests: "hardhat/test",
    cache: "hardhat/cache",
    artifacts: "hardhat/artifacts",
  },
  networks: {
    // In-memory network used only for `npm test` — fast contract-logic
    // verification with throwaway Hardhat accounts.
    hardhat: {},

    // A local `besu --network=dev` or similar, for manual smoke testing.
    localhost: {
      url: "http://127.0.0.1:8545",
    },

    // The real target: a private Besu QBFT network, reached through
    // Web3Signer rather than Besu's own RPC port — see
    // api/src/chain/writeTransaction.ts for the full explanation of why.
    besuQbft: {
      url: process.env.WEB3SIGNER_RPC_URL || "http://localhost:9000",
      // Fixed, non-standard chain ID so a signed tx can never accidentally
      // replay against a public network. Set to the real value from the
      // target network's genesis once one is provisioned.
      chainId: Number(process.env.BESU_CHAIN_ID || 190417),
      // No `accounts` field: Web3Signer exposes its signing address via
      // eth_accounts and Hardhat/ethers picks it up as an "unlocked"
      // account.
    },
  },
};

export default config;
