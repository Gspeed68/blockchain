#!/usr/bin/env node
// Derives an Ethereum address from an AWS KMS asymmetric ECC_SECG_P256K1
// key's public key, so we can pre-fund the app identity's address in
// QBFT-Network/config/qbftConfigFile.json's genesis alloc *before*
// Web3Signer exists to tell us the address itself (chicken-and-egg: the
// genesis has to be generated before the network runs, but Web3Signer only
// exposes eth_accounts once it's running against that network).
//
// Usage: aws kms get-public-key --key-id <arn> --output json \
//          | node scripts/lib/derive-eth-address.js
//
// How it works: `aws kms get-public-key` returns the public key as a
// base64 DER-encoded SubjectPublicKeyInfo (X.509) structure. For an
// uncompressed secp256k1 point that structure always ends in exactly the
// 65-byte uncompressed EC point (0x04 || X (32 bytes) || Y (32 bytes)) —
// the ASN.1 header before it varies by a byte or two depending on the
// library, so rather than hand-parsing ASN.1 we just take the last 65
// bytes and verify the leading byte is 0x04 as a sanity check.
//
// The Ethereum address is then the last 20 bytes of keccak256(X || Y)
// (dropping the leading 0x04) — the same derivation as an ordinary
// secp256k1 keypair; KMS just holds the private half and refuses to ever
// export it.

const { keccak256, hexlify, getBytes } = require("ethers");

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const { PublicKey } = JSON.parse(input);
    const der = Buffer.from(PublicKey, "base64");
    const point = der.subarray(der.length - 65);
    if (point[0] !== 0x04) {
      throw new Error(
        `Expected an uncompressed EC point (0x04 prefix) in the last 65 bytes of the DER key, got 0x${point[0].toString(16)}. ` +
          "Double check the key was created with KeySpec ECC_SECG_P256K1."
      );
    }
    const xy = point.subarray(1); // drop the 0x04 prefix -> 64 bytes (X || Y)
    const hash = getBytes(keccak256(hexlify(xy)));
    const address = "0x" + Buffer.from(hash.subarray(hash.length - 20)).toString("hex");
    console.log(address);
  });
}

main();
