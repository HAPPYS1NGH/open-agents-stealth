// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SignatureVerifier } from "../src/SignatureVerifier.sol";

contract SignatureVerifierTest is Test {
    address constant TARGET = address(0xCAFE);

    function test_makeSignatureHash_isDeterministic() public pure {
        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = 1746302400;

        bytes32 h1 = SignatureVerifier.makeSignatureHash(TARGET, expires, request, result);
        bytes32 h2 = SignatureVerifier.makeSignatureHash(TARGET, expires, request, result);
        assertEq(h1, h2);
    }

    function test_makeSignatureHash_changesOnAnyInputChange() public pure {
        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = 1746302400;
        bytes32 base = SignatureVerifier.makeSignatureHash(TARGET, expires, request, result);

        assertTrue(base != SignatureVerifier.makeSignatureHash(address(0xBEEF), expires, request, result));
        assertTrue(base != SignatureVerifier.makeSignatureHash(TARGET, expires + 1, request, result));
        assertTrue(base != SignatureVerifier.makeSignatureHash(TARGET, expires, hex"deadbeee", result));
        assertTrue(base != SignatureVerifier.makeSignatureHash(TARGET, expires, request, hex"cafebabf"));
    }
}

contract SignatureVerifierVerifyTest is Test {
    function test_verify_recoversSigner() public {
        uint256 signerKey = 0xA11CE;
        address signerAddr = vm.addr(signerKey);

        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = uint64(block.timestamp + 60);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes memory response = abi.encode(result, expires, sig);
        (address recovered, bytes memory got) = this.callVerify(request, response);

        assertEq(recovered, signerAddr);
        assertEq(keccak256(got), keccak256(result));
    }

    function test_verify_revertsIfExpired() public {
        uint256 signerKey = 0xA11CE;
        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = uint64(block.timestamp - 1);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert(bytes("Signature expired"));
        this.callVerify(request, response);
    }

    /// @dev Wrapper so `verify` is called with calldata (it's a `calldata` lib fn).
    function callVerify(bytes calldata request, bytes calldata response)
        external view returns (address, bytes memory)
    {
        return SignatureVerifier.verify(request, response);
    }
}
