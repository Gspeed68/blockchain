import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { CustodyRegistry } from "../typechain-types";

describe("CustodyRegistry", () => {
  let registry: CustodyRegistry;
  let admin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("CustodyRegistry", admin);
    registry = (await factory.deploy()) as unknown as CustodyRegistry;
    await registry.waitForDeployment();
  });

  it("sets the deployer as admin", async () => {
    expect(await registry.admin()).to.equal(admin.address);
  });

  it("registers an item and seeds a Registered custody event", async () => {
    const tx = await registry.registerItem(
      "SKU-001",
      "Palladium reference painting, crated",
      "fine-art",
      "Geneva Freeport",
      "Geneva Freeport Logistics",
      "https://example.com/docs/intake-form.pdf",
      ethers.keccak256(ethers.toUtf8Bytes("fake-doc-bytes"))
    );
    const receipt = await tx.wait();
    expect(receipt?.status).to.equal(1);

    const ids = await registry.getAllItemIds();
    expect(ids.length).to.equal(1);

    const item = await registry.getItem(ids[0]);
    expect(item.sku).to.equal("SKU-001");
    expect(item.currentCustodian).to.equal("Geneva Freeport Logistics");
    expect(item.status).to.equal(0n); // ItemStatus.Registered

    const history = await registry.getCustodyEvents(ids[0]);
    expect(history.length).to.equal(1);
    expect(history[0].eventType).to.equal(0n); // EventType.Registered
    expect(history[0].fromCustodian).to.equal("");
    expect(history[0].toCustodian).to.equal("Geneva Freeport Logistics");
  });

  it("appends custody events and keeps the cached current state in sync", async () => {
    await (
      await registry.registerItem(
        "SKU-002",
        "Insulin shipment, 200 units",
        "pharmaceutical",
        "Basel DC",
        "SwissCargo AG",
        "https://example.com/docs/manifest.pdf",
        ethers.ZeroHash
      )
    ).wait();

    await (
      await registry.recordCustodyEvent(
        1,
        1, // EventType.Transferred
        "Lufthansa Cargo",
        "Zurich Airport",
        "Handed off at airport dock 4",
        "https://example.com/docs/handoff-1.pdf",
        ethers.ZeroHash
      )
    ).wait();

    await (
      await registry.recordCustodyEvent(
        1,
        3, // EventType.Delivered
        "City General Hospital Pharmacy",
        "City General Hospital",
        "Cold chain intact, temp log attached",
        "https://example.com/docs/delivery-1.pdf",
        ethers.ZeroHash
      )
    ).wait();

    const history = await registry.getCustodyEvents(1);
    expect(history.length).to.equal(3); // Registered + Transferred + Delivered
    expect(history[1].fromCustodian).to.equal("SwissCargo AG");
    expect(history[1].toCustodian).to.equal("Lufthansa Cargo");
    expect(history[2].fromCustodian).to.equal("Lufthansa Cargo");
    expect(history[2].toCustodian).to.equal("City General Hospital Pharmacy");

    const item = await registry.getItem(1);
    expect(item.currentCustodian).to.equal("City General Hospital Pharmacy");
    expect(item.currentLocation).to.equal("City General Hospital");
    expect(item.status).to.equal(3n); // ItemStatus.Delivered

    const latest = await registry.getLatestCustodyEvent(1);
    expect(latest.toCustodian).to.equal("City General Hospital Pharmacy");
  });

  it("leaves status unchanged on an Inspected event", async () => {
    await (
      await registry.registerItem("SKU-003", "Server rack", "electronics", "Depot A", "Depot A", "", ethers.ZeroHash)
    ).wait();
    await (
      await registry.recordCustodyEvent(1, 1, "Depot A", "Depot A", "moved to bay 2", "", ethers.ZeroHash) // Transferred
    ).wait();

    let item = await registry.getItem(1);
    expect(item.status).to.equal(2n); // ItemStatus.AtCustodian

    await (
      await registry.recordCustodyEvent(1, 2, "Depot A", "Depot A", "routine check, no damage", "", ethers.ZeroHash) // Inspected
    ).wait();

    item = await registry.getItem(1);
    expect(item.status).to.equal(2n); // unchanged
  });

  it("rejects writes from a non-admin address", async () => {
    await expect(
      registry
        .connect(stranger)
        .registerItem("SKU", "Description", "category", "origin", "custodian", "", ethers.ZeroHash)
    ).to.be.revertedWithCustomError(registry, "NotAdmin");
  });

  it("reverts on an unknown item id", async () => {
    await expect(registry.getItem(999)).to.be.revertedWithCustomError(registry, "ItemNotFound").withArgs(999);
  });

  it("rejects recording a Registered event through recordCustodyEvent", async () => {
    await (
      await registry.registerItem("SKU-004", "Widget", "goods", "Origin", "Custodian", "", ethers.ZeroHash)
    ).wait();
    await expect(
      registry.recordCustodyEvent(1, 0, "Custodian", "Origin", "", "", ethers.ZeroHash) // EventType.Registered
    ).to.be.revertedWith("CustodyRegistry: Registered is seeded automatically only");
  });
});
