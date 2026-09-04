#!/usr/bin/env node
// Takes whatever directory layout `besu operator generate-blockchain-config`
// produced under QBFT-Network/generated/ and turns it into the stable,
// known layout docker/docker-compose.yml expects:
//
//   docker/besu/validators/validator-<N>/key          (private key, as generated)
//   docker/besu/validators/validator-<N>/key.pub       (public key, as generated)
//   docker/besu/validators/validator-<N>/bootnodes.txt (comma-separated enode list of the OTHER validators)
//
// Why not reference Besu's generated directory names directly from
// docker-compose.yml: those directories are named after each validator's
// derived address (decided at generation time, different every run), so a
// compose file with hardcoded paths would need hand-editing after every
// regeneration. This script does that mapping once, automatically.
//
// enode URLs: an enode ID is just the raw 64-byte uncompressed public key
// (X || Y, i.e. key.pub's content with any leading "04" byte stripped),
// hex-encoded with no 0x prefix — NOT hashed like an Ethereum address is.
// See scripts/lib/derive-eth-address.js for the (different) address
// derivation, which IS a keccak256 hash of the same bytes.
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const GENERATED_DIR = path.join(REPO_ROOT, "QBFT-Network", "generated");
const OUT_DIR = path.join(REPO_ROOT, "docker", "besu", "validators");
const P2P_PORT = 30303;

function isHexAddressDir(name) {
  return /^0x[0-9a-fA-F]{40}$/.test(name);
}

function normalizePubKeyHex(raw) {
  let hex = raw.trim().replace(/^0x/i, "");
  if (hex.length === 130 && hex.startsWith("04")) {
    hex = hex.slice(2); // drop uncompressed-point prefix byte if present
  }
  if (hex.length !== 128) {
    throw new Error(`Expected a 64-byte (128 hex char) public key, got ${hex.length} hex chars`);
  }
  return hex.toLowerCase();
}

function main() {
  if (!fs.existsSync(GENERATED_DIR)) {
    throw new Error(`${GENERATED_DIR} not found — run scripts/03-generate-qbft-genesis.sh first`);
  }

  const validatorDirs = fs
    .readdirSync(GENERATED_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isHexAddressDir(d.name))
    .map((d) => d.name)
    .sort(); // deterministic ordering across runs

  if (validatorDirs.length === 0) {
    throw new Error(
      `No validator key directories (0x...) found directly under ${GENERATED_DIR}. ` +
        "Check the actual output layout of `besu operator generate-blockchain-config` for the pinned " +
        "Besu image version and adjust this script's directory-discovery logic if it differs " +
        "(document the change as a dated Correction in README-BOURBON-PORT.md)."
    );
  }

  console.log(`Found ${validatorDirs.length} validator key directories:`, validatorDirs);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const nodes = validatorDirs.map((addr, i) => {
    const srcDir = path.join(GENERATED_DIR, addr);
    const destDir = path.join(OUT_DIR, `validator-${i + 1}`);
    fs.mkdirSync(destDir, { recursive: true });

    const key = fs.readFileSync(path.join(srcDir, "key"), "utf8").trim();
    const pub = fs.readFileSync(path.join(srcDir, "key.pub"), "utf8").trim();

    fs.writeFileSync(path.join(destDir, "key"), key + "\n");
    fs.writeFileSync(path.join(destDir, "key.pub"), pub + "\n");

    return { index: i + 1, address: addr, destDir, enodeId: normalizePubKeyHex(pub) };
  });

  for (const node of nodes) {
    const peers = nodes
      .filter((n) => n.index !== node.index)
      .map((n) => `enode://${n.enodeId}@besu-validator-${n.index}:${P2P_PORT}`);
    fs.writeFileSync(path.join(node.destDir, "bootnodes.txt"), peers.join(","));
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), nodes: nodes.map(({ index, address }) => ({ index, address })) },
      null,
      2
    )
  );

  console.log(`Wrote validator-1..${nodes.length} into ${OUT_DIR} with per-node bootnodes.txt.`);
  console.log("Validator addresses:", nodes.map((n) => `#${n.index}=${n.address}`).join(", "));
}

main();
