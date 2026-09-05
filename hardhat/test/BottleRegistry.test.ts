import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BottleRegistry } from "../typechain-types";

describe("BottleRegistry", () => {
  let registry: BottleRegistry;
  let admin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("BottleRegistry", admin);
    registry = (await factory.deploy()) as unknown as BottleRegistry;
    await registry.waitForDeployment();
  });

  it("sets the deployer as admin", async () => {
    expect(await registry.admin()).to.equal(admin.address);
  });

  it("adds a bottle and seeds a purchase-price appraisal", async () => {
    const tx = await registry.addBottle(
      "Buffalo Trace",
      "E.H. Taylor Single Barrel",
      1000, // 100.0 proof
      2023,
      Math.floor(Date.UTC(2023, 5, 1) / 1000),
      6499, // $64.99
      0, // Condition.Sealed
      10_000, // 100% full
      "https://example.com/photos/eht-single-barrel.jpg",
      ethers.keccak256(ethers.toUtf8Bytes("fake-photo-bytes"))
    );
    const receipt = await tx.wait();
    expect(receipt?.status).to.equal(1);

    const ids = await registry.getAllBottleIds();
    expect(ids.length).to.equal(1);

    const bottle = await registry.getBottle(ids[0]);
    expect(bottle.distillery).to.equal("Buffalo Trace");
    expect(bottle.purchasePriceCents).to.equal(6499n);

    const history = await registry.getAppraisals(ids[0]);
    expect(history.length).to.equal(1);
    expect(history[0].source).to.equal("purchase");
    expect(history[0].valueCents).to.equal(6499n);
  });

  it("appends appraisals without overwriting history", async () => {
    await (
      await registry.addBottle(
        "Willett",
        "Family Estate Rye",
        1140,
        2022,
        Math.floor(Date.UTC(2022, 2, 1) / 1000),
        15000,
        0,
        10_000,
        "https://example.com/photos/willett-rye.jpg",
        ethers.ZeroHash
      )
    ).wait();

    await (await registry.recordAppraisal(1, 22000, "whiskyhunter", "auction median, 3 comps")).wait();
    await (await registry.recordAppraisal(1, 24500, "whiskyhunter", "auction median, 5 comps")).wait();

    const history = await registry.getAppraisals(1);
    expect(history.length).to.equal(3); // purchase + 2 recorded
    expect(history.map((a) => a.valueCents)).to.deep.equal([15000n, 22000n, 24500n]);

    const latest = await registry.getLatestAppraisal(1);
    expect(latest.valueCents).to.equal(24500n);
  });

  it("rejects writes from a non-admin address", async () => {
    await expect(
      registry
        .connect(stranger)
        .addBottle("Distillery", "Bottle", 1000, 2020, 0, 1000, 0, 10_000, "uri", ethers.ZeroHash)
    ).to.be.revertedWithCustomError(registry, "NotAdmin");
  });

  it("reverts on an unknown bottle id", async () => {
    await expect(registry.getBottle(999)).to.be.revertedWithCustomError(registry, "BottleNotFound").withArgs(999);
  });
});
