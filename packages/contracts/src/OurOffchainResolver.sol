// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { SignatureVerifier } from "./SignatureVerifier.sol";

/// @notice ENSIP-10 wildcard resolution interface.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

/// @notice ENSIP-10 wildcard resolver implementing ERC-3668 CCIP-Read.
/// Set as the resolver for a parent name (e.g., gabhru.eth) so that all
/// subname queries are forwarded to the configured offchain gateway.
///
/// Forked from ENS's offchain-resolver reference and trimmed to the
/// authorized-signers pattern.
contract OurOffchainResolver is IExtendedResolver, Ownable2Step, ERC165 {
    /// @notice Thrown to instruct CCIP-Read clients to call the gateway.
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    /// @notice Thrown when a CCIP-Read response is signed by an address
    /// that is not in the authorized signers set.
    error UnauthorisedSigner(address recovered);

    string[] public urls;
    mapping(address => bool) public signers;

    event NewSigners(address indexed signer, bool authorized);
    event UrlsUpdated(string[] urls);

    constructor(string[] memory _urls, address[] memory _signers) Ownable(msg.sender) {
        require(_urls.length > 0, "OurOffchainResolver: urls empty");
        urls = _urls;
        for (uint256 i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0), "OurOffchainResolver: zero signer");
            signers[_signers[i]] = true;
            emit NewSigners(_signers[i], true);
        }
    }

    /// @notice Owner-only signer rotation.
    function setSigner(address signer, bool authorized) external onlyOwner {
        require(signer != address(0), "OurOffchainResolver: zero signer");
        signers[signer] = authorized;
        emit NewSigners(signer, authorized);
    }

    /// @notice Owner-only gateway URL update.
    function setUrls(string[] memory _urls) external onlyOwner {
        require(_urls.length > 0, "OurOffchainResolver: urls empty");
        urls = _urls;
        emit UrlsUpdated(_urls);
    }

    /// @notice ENSIP-10 entry point. Always reverts with OffchainLookup
    /// to redirect resolution to the gateway.
    /// @param name DNS-encoded name (per ENS resolver convention)
    /// @param data Original resolver call data (e.g., addr/text/contenthash)
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(this.resolve.selector, name, data);
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData
        );
    }

    /// @notice Callback target for CCIP-Read. Verifies that the gateway
    /// signature is from an authorized signer and returns the encoded result.
    /// @param response ABI-encoded (bytes result, uint64 expires, bytes sig)
    /// @param extraData The original calldata that triggered the offchain lookup
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (address signer, bytes memory result) = SignatureVerifier.verify(extraData, response);
        if (!signers[signer]) revert UnauthorisedSigner(signer);
        return result;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC165)
        returns (bool)
    {
        // type(IExtendedResolver).interfaceId == 0x9061b923
        return interfaceId == type(IExtendedResolver).interfaceId || super.supportsInterface(interfaceId);
    }
}
