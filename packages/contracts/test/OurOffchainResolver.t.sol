// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OurOffchainResolver } from "../src/OurOffchainResolver.sol";
import { SignatureVerifier } from "../src/SignatureVerifier.sol";

contract OurOffchainResolverTest is Test {
    OurOffchainResolver internal resolver;
    address internal owner = address(0xABCD);
    address internal signer;
    uint256 internal signerKey;
    string[] internal urls;

    function setUp() public {
        signerKey = 0xA11CE;
        signer = vm.addr(signerKey);
        urls = new string[](1);
        urls[0] = "https://api.gabhru.eth.limo/resolve/{sender}/{data}";

        vm.prank(owner);
        resolver = new OurOffchainResolver(urls, _toArray(signer));
    }

    function _toArray(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function test_supportsExtendedResolverInterface() public view {
        // ENSIP-10 IExtendedResolver
        assertTrue(resolver.supportsInterface(0x9061b923));
        // ERC-165
        assertTrue(resolver.supportsInterface(0x01ffc9a7));
    }

    function test_resolve_revertsWithOffchainLookup() public {
        bytes memory dnsName = _dnsEncode("test.gabhru.eth");
        // calldata for addr(bytes32 node)
        bytes memory data = abi.encodeWithSelector(0x3b3b57de, bytes32(uint256(0x1234)));

        // Capture the OffchainLookup revert
        vm.expectRevert();
        resolver.resolve(dnsName, data);
    }

    function test_resolveWithProof_acceptsValidSignature() public {
        bytes memory request = hex"deadbeef";
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        bytes memory out = resolver.resolveWithProof(response, request);
        assertEq(keccak256(out), keccak256(result));
    }

    function test_resolveWithProof_rejectsUnknownSigner() public {
        uint256 unknownKey = 0xDEAD;
        bytes memory request = hex"deadbeef";
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(unknownKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert(bytes("OurOffchainResolver: unauthorised signer"));
        resolver.resolveWithProof(response, request);
    }

    function test_owner_canRotateSigners() public {
        address newSigner = address(0xBEEF);
        vm.prank(owner);
        resolver.setSigner(newSigner, true);
        assertTrue(resolver.signers(newSigner));

        vm.prank(owner);
        resolver.setSigner(signer, false);
        assertFalse(resolver.signers(signer));
    }

    function test_nonOwner_cannotRotateSigners() public {
        vm.prank(address(0xBADBAD));
        vm.expectRevert();
        resolver.setSigner(address(0xBEEF), true);
    }

    function _dnsEncode(string memory name) internal pure returns (bytes memory) {
        bytes memory raw = bytes(name);
        bytes memory result = new bytes(raw.length + 2);
        uint256 labelStart = 0;
        uint256 outIdx = 0;
        for (uint256 i = 0; i <= raw.length; i++) {
            if (i == raw.length || raw[i] == ".") {
                uint256 labelLen = i - labelStart;
                result[outIdx++] = bytes1(uint8(labelLen));
                for (uint256 j = labelStart; j < i; j++) {
                    result[outIdx++] = raw[j];
                }
                labelStart = i + 1;
            }
        }
        result[outIdx] = 0x00;
        bytes memory trimmed = new bytes(outIdx + 1);
        for (uint256 k = 0; k <= outIdx; k++) trimmed[k] = result[k];
        return trimmed;
    }
}
