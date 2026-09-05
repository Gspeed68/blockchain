import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys BottleRegistry and writes its address + ABI to
 * api/src/config/contract.json so the backend picks up the new address
 * without any manual copy/paste. Run with:
 *
 *   npm run deploy:local   (against a local hardhat/besu node)
 *   npm run deploy:besu    (against the real network, signed via Web3Signer/Key Vault)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying BottleRegistry on "${network.name}" as ${deployer.address}`);

  const factory = await ethers.getContractFactory("BottleRegistry", deployer);
  const contract = await factory.deploy();

  // `deploy()` only broadcasts the transaction; the contract address it
  // returns isn't final until the deployment tx is actually mined.
  // `waitForDeployment()` polls for the receipt the same way api/src/chain
  // does for every other write — see that module for the long-form version
  // of what this one-liner hides.
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();

  console.log(`BottleRegistry deployed at ${address}`);
  console.log(`  tx hash: ${deployTx?.hash}`);
  console.log(`  block:   ${deployTx?.blockNumber ?? "(pending)"}`);

  const artifact = await import(
    path.join(__dirname, "..", "artifacts", "contracts", "BottleRegistry.sol", "BottleRegistry.json")
  );

  const outPath = path.join(__dirname, "..", "..", "api", "src", "config", "contract.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: network.name,
        address,
        deployTxHash: deployTx?.hash,
        abi: artifact.abi,
      },
      null,
      2
    )
  );
  console.log(`Wrote contract address + ABI to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
