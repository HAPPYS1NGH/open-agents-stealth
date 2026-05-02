// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Helpers for verifying signed CCIP-Read responses per ERC-3668.
/// Ported from ENS's OffchainResolver reference implementation.
library SignatureVerifier {
    /// @dev The hash format covers: target contract, expiry, original request
    /// calldata, and result bytes. A signature over this hash binds a result
    /// to a specific resolver+request and prevents cross-binding replays.
    function makeSignatureHash(
        address target,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            hex"1900",
            target,
            expires,
            keccak256(request),
            keccak256(result)
        ));
    }

    /// @dev Recovers the signer of (request, result, expires) and returns
    /// the recovered address along with the result bytes.
    function verify(
        bytes calldata request,
        bytes calldata response
    ) internal view returns (address signer, bytes memory result) {
        require(response.length >= 96, "Response too short");
        uint64 expires;
        bytes memory sig;
        (result, expires, sig) = abi.decode(response, (bytes, uint64, bytes));
        require(expires >= block.timestamp, "Signature expired");
        bytes32 hash = makeSignatureHash(address(this), expires, request, result);
        signer = ECDSA.recover(hash, sig);
    }
}
