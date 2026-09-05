#!/usr/bin/env node
// Derives an Ethereum address from an Azure Key Vault EC (P-256K/secp256k1)
// key's public half, so we can pre-fund the app identity's address in
// QBFT-Network/config/qbftConfigFile.json's genesis alloc before Web3Signer
// exists to report the address itself (same chicken-and-egg problem as the
// AWS KMS version this replaced — see scripts/lib/derive-eth-address.js in
// git history for that one).
//
// Usage: az keyvault key show --vault-name <vault> --name <key> -o json \
//          | node scripts/lib/derive-eth-address-azure.js
//
// Unlike AWS KMS (which returns a DER-encoded X.509 SubjectPublicKeyInfo
// that needs ASN.1 unwrapping), Azure Key Vault returns the public key
// directly as a JWK: `key.x` and `key.y` are the raw 32-byte EC point
// coordinates, base64url-encoded, with no wrapping to strip. That makes
// this derivation simpler than the AWS one — there's no header to locate,
// just two fields to base64url-decode.
//
// The Ethereum address is the last 20 bytes of keccak256(X || Y) — the same
// derivation as an ordinary secp256k1 keypair; Key Vault just holds the
// private half and refuses to ever export it (an "azure-key" Web3Signer
// key, per docker/web3signer/keys/eth1-app-identity.yaml.template, signs
// remotely inside the vault — the private key never leaves Azure either).
const { keccak256, hexlify, getBytes } = require("ethers");

function base64UrlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const parsed = JSON.parse(input);
    const key = parsed.key ?? parsed; // `az keyvault key show` nests under .key
    if (!key.x || !key.y) {
      throw new Error(
        "Expected a JWK with 'x' and 'y' fields (an EC public key). Got: " + JSON.stringify(key)
      );
    }
    const x = base64UrlToBuffer(key.x);
    const y = base64UrlToBuffer(key.y);
    if (x.length !== 32 || y.length !== 32) {
      throw new Error(
        `Expected 32-byte X/Y coordinates (P-256K), got ${x.length} and ${y.length} bytes. ` +
          "Double check the key's curve is P-256K/SECP256K1."
      );
    }
    const xy = Buffer.concat([x, y]);
    const hash = getBytes(keccak256(hexlify(xy)));
    const address = "0x" + Buffer.from(hash.subarray(hash.length - 20)).toString("hex");
    console.log(address);
  });
}

main();
