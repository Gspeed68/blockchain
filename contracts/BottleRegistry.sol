// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BottleRegistry
/// @notice On-chain provenance registry for a personal bourbon/whiskey collection.
///
/// Design notes (read this before touching write logic):
///
/// 1. Single-writer model. This is a *personal* collection app, not a public
///    marketplace — every write comes from one backend identity (the KMS-backed
///    Web3Signer key described in README-BOURBON-PORT.md). The contract is
///    `Ownable`-style: only the address that deployed it (or whichever address
///    the current owner transfers admin to) may add bottles or record
///    appraisals. `bottle.owner` is stored for display/provenance purposes,
///    not as an access-control primitive — there is intentionally no
///    `transferBottle()` here, because there is no counterparty/marketplace
///    concept in this app yet. Add one later behind its own KMS identity if
///    that changes; don't bolt it onto this contract speculatively.
///
/// 2. Appraisals are append-only. `recordAppraisal` never overwrites a prior
///    value — it pushes a new entry onto a per-bottle array, so the full
///    valuation history (and who/what recorded it) is always reconstructable
///    on-chain. There is no "current price" field on `Bottle`; callers derive
///    "current value" by reading the last element of `getAppraisals(id)`.
///
/// 3. Money is stored as integer cents (uint256) to avoid floating point
///    entirely on-chain. The API layer is responsible for formatting cents
///    into a display currency.
///
/// 4. Photos are stored off-chain (S3, IPFS, wherever) — only a URI and a
///    content hash live on-chain, so provenance ("this is definitely the
///    photo that was attached when the bottle was registered") survives even
///    if the URI later rots.
contract BottleRegistry {
    enum Condition {
        Sealed, // factory seal intact, never opened
        OpenPourable, // opened, still has meaningful fill
        LowFill, // opened, fill level below ~50%
        Empty, // kept for the empty bottle / collector value only
        Damaged // label damage, cap issues, fill loss from evaporation, etc.
    }

    struct Bottle {
        uint256 id;
        address owner; // provenance display field, see contract-level note (1)
        string distillery;
        string bottleName;
        uint16 proof; // stored as proof * 10, e.g. 100.6 proof -> 1006
        uint16 releaseYear;
        uint64 purchaseDate; // unix timestamp (seconds)
        uint256 purchasePriceCents;
        Condition condition;
        uint16 fillLevelBps; // basis points, 0-10000 (10000 = 100% full)
        string photoURI; // e.g. "ipfs://bafy..." or "https://.../bottle.jpg"
        bytes32 photoHash; // sha256 of the photo bytes, for integrity
        uint64 createdAt;
        bool exists;
    }

    struct Appraisal {
        uint256 id;
        uint256 bottleId;
        uint256 valueCents;
        uint64 timestamp;
        string source; // e.g. "whiskyhunter", "ebay-browse", "manual"
        string note; // free-text context, e.g. "median of 3 comps"
        address recordedBy;
    }

    address public admin;
    uint256 private nextBottleId = 1;
    uint256 private nextAppraisalId = 1;
    uint256[] private bottleIds;

    mapping(uint256 => Bottle) private bottles;
    mapping(uint256 => Appraisal[]) private appraisalsByBottle;

    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event BottleAdded(uint256 indexed bottleId, address indexed owner, string distillery, string bottleName);
    event BottleConditionUpdated(uint256 indexed bottleId, Condition condition, uint16 fillLevelBps);
    event AppraisalRecorded(
        uint256 indexed bottleId, uint256 indexed appraisalId, uint256 valueCents, string source
    );

    error NotAdmin();
    error BottleNotFound(uint256 bottleId);
    error EmptyString(string field);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier bottleMustExist(uint256 bottleId) {
        if (!bottles[bottleId].exists) revert BottleNotFound(bottleId);
        _;
    }

    constructor() {
        admin = msg.sender;
        emit AdminTransferred(address(0), msg.sender);
    }

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "BottleRegistry: zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function addBottle(
        string calldata distillery,
        string calldata bottleName,
        uint16 proof,
        uint16 releaseYear,
        uint64 purchaseDate,
        uint256 purchasePriceCents,
        Condition condition,
        uint16 fillLevelBps,
        string calldata photoURI,
        bytes32 photoHash
    ) external onlyAdmin returns (uint256 bottleId) {
        if (bytes(distillery).length == 0) revert EmptyString("distillery");
        if (bytes(bottleName).length == 0) revert EmptyString("bottleName");
        require(fillLevelBps <= 10_000, "BottleRegistry: fillLevelBps > 100%");

        bottleId = nextBottleId++;
        bottles[bottleId] = Bottle({
            id: bottleId,
            owner: msg.sender,
            distillery: distillery,
            bottleName: bottleName,
            proof: proof,
            releaseYear: releaseYear,
            purchaseDate: purchaseDate,
            purchasePriceCents: purchasePriceCents,
            condition: condition,
            fillLevelBps: fillLevelBps,
            photoURI: photoURI,
            photoHash: photoHash,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        bottleIds.push(bottleId);

        emit BottleAdded(bottleId, msg.sender, distillery, bottleName);

        // Every bottle starts its provenance trail with a "day zero" appraisal
        // pinned to the purchase price, so the value-over-time chart always
        // has a real starting point instead of an empty history.
        _recordAppraisal(bottleId, purchasePriceCents, "purchase", "Initial value set to purchase price");
    }

    function updateCondition(uint256 bottleId, Condition condition, uint16 fillLevelBps)
        external
        onlyAdmin
        bottleMustExist(bottleId)
    {
        require(fillLevelBps <= 10_000, "BottleRegistry: fillLevelBps > 100%");
        bottles[bottleId].condition = condition;
        bottles[bottleId].fillLevelBps = fillLevelBps;
        emit BottleConditionUpdated(bottleId, condition, fillLevelBps);
    }

    function recordAppraisal(uint256 bottleId, uint256 valueCents, string calldata source, string calldata note)
        external
        onlyAdmin
        bottleMustExist(bottleId)
        returns (uint256 appraisalId)
    {
        appraisalId = _recordAppraisal(bottleId, valueCents, source, note);
    }

    function _recordAppraisal(uint256 bottleId, uint256 valueCents, string memory source, string memory note)
        private
        returns (uint256 appraisalId)
    {
        appraisalId = nextAppraisalId++;
        appraisalsByBottle[bottleId].push(
            Appraisal({
                id: appraisalId,
                bottleId: bottleId,
                valueCents: valueCents,
                timestamp: uint64(block.timestamp),
                source: source,
                note: note,
                recordedBy: msg.sender
            })
        );
        emit AppraisalRecorded(bottleId, appraisalId, valueCents, source);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    function getBottle(uint256 bottleId) external view bottleMustExist(bottleId) returns (Bottle memory) {
        return bottles[bottleId];
    }

    function getAllBottleIds() external view returns (uint256[] memory) {
        return bottleIds;
    }

    function bottleCount() external view returns (uint256) {
        return bottleIds.length;
    }

    function getAppraisals(uint256 bottleId)
        external
        view
        bottleMustExist(bottleId)
        returns (Appraisal[] memory)
    {
        return appraisalsByBottle[bottleId];
    }

    function getLatestAppraisal(uint256 bottleId)
        external
        view
        bottleMustExist(bottleId)
        returns (Appraisal memory)
    {
        Appraisal[] storage history = appraisalsByBottle[bottleId];
        require(history.length > 0, "BottleRegistry: no appraisals");
        return history[history.length - 1];
    }

    function appraisalCount(uint256 bottleId) external view bottleMustExist(bottleId) returns (uint256) {
        return appraisalsByBottle[bottleId].length;
    }
}
