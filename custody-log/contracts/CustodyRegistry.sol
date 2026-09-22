// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CustodyRegistry
/// @notice On-chain chain-of-custody log for physical items moving between
/// custodians (e.g. pharma shipments, fine art, high-value freight).
///
/// Design notes (read this before touching write logic) — this follows the
/// same pattern as the sibling BottleRegistry project (../../contracts/
/// BottleRegistry.sol) deliberately, so read that contract's notes too if
/// something here seems terse:
///
/// 1. Single-writer model. Every write comes from one backend identity (a
///    Web3Signer-held key — see the API layer). `Item.registeredBy` is
///    stored for provenance display only, not as an access-control
///    primitive. Custodians in this contract are free-text names
///    (`fromCustodian`/`toCustodian`), not addresses — this app models
///    "who physically holds the item right now" as data the backend
///    attests to (from a scan, a signed bill of lading, a warehouse system
///    webhook), not as on-chain accounts with their own signing keys. If a
///    future version needs a custodian to independently attest to a
///    handoff themselves, that's a real access-control change and deserves
///    its own design, not a field bolted onto this one.
///
/// 2. Custody events are append-only. `recordCustodyEvent` never overwrites
///    a prior entry — it pushes onto a per-item array, so the full chain of
///    custody is always reconstructable on-chain, in order, forever. There
///    is no "edit" or "delete" for a custody event: a correction is itself
///    a new event, never a mutation of history. `Item.currentCustodian`/
///    `currentLocation`/`status` are a denormalized "latest known state"
///    cache for cheap reads (so `getItem` alone answers "where is it, who
///    has it" without walking the full history) — the events array remains
///    the source of truth.
///
/// 3. Supporting documents (bills of lading, inspection certs, photos of
///    condition at handoff) are stored off-chain — only a URI and a sha256
///    content hash live on-chain, so a document's integrity is provable
///    even if the URI later rots.
contract CustodyRegistry {
    enum ItemStatus {
        Registered, // created, not yet handed off
        InTransit, // reserved for future use by an explicit "pickup" event; unused by the current event set
        AtCustodian, // confirmed received and stationary
        Delivered, // reached its final destination
        Damaged, // last event reported damage
        Lost // last event reported the item lost
    }

    enum EventType {
        Registered, // seeded automatically by registerItem()
        Transferred, // custody handed off to a new custodian
        Inspected, // condition/location check, no custody change
        Delivered, // reached final destination
        Damaged, // damage reported
        Lost // item reported lost
    }

    struct Item {
        uint256 id;
        address registeredBy; // provenance display field, see contract-level note (1)
        string sku;
        string description;
        string category; // e.g. "pharmaceutical", "fine-art", "electronics"
        string originLocation;
        ItemStatus status;
        string currentCustodian;
        string currentLocation;
        uint64 createdAt;
        bool exists;
    }

    struct CustodyEvent {
        uint256 id;
        uint256 itemId;
        EventType eventType;
        string fromCustodian; // empty for the seeded Registered event
        string toCustodian;
        string location;
        string notes;
        string documentURI; // e.g. "ipfs://bafy..." or "https://.../bol.pdf"
        bytes32 documentHash; // sha256 of the document bytes, for integrity
        uint64 timestamp;
        address recordedBy;
    }

    address public admin;
    uint256 private nextItemId = 1;
    uint256 private nextEventId = 1;
    uint256[] private itemIds;

    mapping(uint256 => Item) private items;
    mapping(uint256 => CustodyEvent[]) private eventsByItem;

    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event ItemRegistered(uint256 indexed itemId, address indexed registeredBy, string sku, string description);
    event CustodyEventRecorded(
        uint256 indexed itemId, uint256 indexed eventId, EventType eventType, string toCustodian
    );

    error NotAdmin();
    error ItemNotFound(uint256 itemId);
    error EmptyString(string field);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier itemMustExist(uint256 itemId) {
        if (!items[itemId].exists) revert ItemNotFound(itemId);
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
        require(newAdmin != address(0), "CustodyRegistry: zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function registerItem(
        string calldata sku,
        string calldata description,
        string calldata category,
        string calldata originLocation,
        string calldata initialCustodian,
        string calldata documentURI,
        bytes32 documentHash
    ) external onlyAdmin returns (uint256 itemId) {
        if (bytes(sku).length == 0) revert EmptyString("sku");
        if (bytes(description).length == 0) revert EmptyString("description");
        if (bytes(initialCustodian).length == 0) revert EmptyString("initialCustodian");

        itemId = nextItemId++;
        items[itemId] = Item({
            id: itemId,
            registeredBy: msg.sender,
            sku: sku,
            description: description,
            category: category,
            originLocation: originLocation,
            status: ItemStatus.Registered,
            currentCustodian: initialCustodian,
            currentLocation: originLocation,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        itemIds.push(itemId);

        emit ItemRegistered(itemId, msg.sender, sku, description);

        // Every item starts its custody trail with a "day zero" event, so
        // the history is never empty and always shows who first held it and
        // where — mirrors BottleRegistry's seeded purchase-price appraisal.
        // fromCustodian is deliberately "" — there is no prior custodian.
        _recordCustodyEvent(
            itemId, EventType.Registered, "", initialCustodian, originLocation, "Item registered", documentURI, documentHash
        );
    }

    /// @notice Append a custody event and update the item's cached
    /// current-state fields to match it. `fromCustodian` is read from the
    /// item's current state automatically — callers only supply what's
    /// changing (the new custodian/location/notes/documents).
    function recordCustodyEvent(
        uint256 itemId,
        EventType eventType,
        string calldata toCustodian,
        string calldata location,
        string calldata notes,
        string calldata documentURI,
        bytes32 documentHash
    ) external onlyAdmin itemMustExist(itemId) returns (uint256 eventId) {
        require(eventType != EventType.Registered, "CustodyRegistry: Registered is seeded automatically only");
        string memory fromCustodian = items[itemId].currentCustodian;
        eventId =
            _recordCustodyEvent(itemId, eventType, fromCustodian, toCustodian, location, notes, documentURI, documentHash);
    }

    function _recordCustodyEvent(
        uint256 itemId,
        EventType eventType,
        string memory fromCustodian,
        string memory toCustodian,
        string memory location,
        string memory notes,
        string memory documentURI,
        bytes32 documentHash
    ) private returns (uint256 eventId) {
        eventId = nextEventId++;
        eventsByItem[itemId].push(
            CustodyEvent({
                id: eventId,
                itemId: itemId,
                eventType: eventType,
                fromCustodian: fromCustodian,
                toCustodian: toCustodian,
                location: location,
                notes: notes,
                documentURI: documentURI,
                documentHash: documentHash,
                timestamp: uint64(block.timestamp),
                recordedBy: msg.sender
            })
        );

        // Keep the item's cached "current state" in sync — see
        // contract-level note (2). Inspected deliberately leaves `status`
        // alone: it's a check-in, not a change of custody or condition
        // class, though it can still update the recorded location.
        Item storage item = items[itemId];
        item.currentCustodian = toCustodian;
        item.currentLocation = location;
        if (eventType == EventType.Registered) item.status = ItemStatus.Registered;
        else if (eventType == EventType.Transferred) item.status = ItemStatus.AtCustodian;
        else if (eventType == EventType.Delivered) item.status = ItemStatus.Delivered;
        else if (eventType == EventType.Damaged) item.status = ItemStatus.Damaged;
        else if (eventType == EventType.Lost) item.status = ItemStatus.Lost;

        emit CustodyEventRecorded(itemId, eventId, eventType, toCustodian);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    function getItem(uint256 itemId) external view itemMustExist(itemId) returns (Item memory) {
        return items[itemId];
    }

    function getAllItemIds() external view returns (uint256[] memory) {
        return itemIds;
    }

    function itemCount() external view returns (uint256) {
        return itemIds.length;
    }

    function getCustodyEvents(uint256 itemId) external view itemMustExist(itemId) returns (CustodyEvent[] memory) {
        return eventsByItem[itemId];
    }

    function getLatestCustodyEvent(uint256 itemId)
        external
        view
        itemMustExist(itemId)
        returns (CustodyEvent memory)
    {
        CustodyEvent[] storage history = eventsByItem[itemId];
        require(history.length > 0, "CustodyRegistry: no custody events");
        return history[history.length - 1];
    }

    function custodyEventCount(uint256 itemId) external view itemMustExist(itemId) returns (uint256) {
        return eventsByItem[itemId].length;
    }
}
