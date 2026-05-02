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

    function test_verify_recoversWrongSignerOnTamperedResult() public {
        uint256 signerKey = 0xA11CE;
        address signerAddr = vm.addr(signerKey);

        bytes memory originalResult = hex"cafebabe";
        bytes memory tamperedResult = hex"cafebabf";  // 1 byte different
        uint64 expires = uint64(block.timestamp + 60);
        bytes memory request = hex"deadbeef";

        // Signer signs over the ORIGINAL result
        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, request, originalResult);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        // But the response carries the TAMPERED result
        bytes memory response = abi.encode(tamperedResult, expires, sig);
        (address recovered, bytes memory got) = this.callVerify(request, response);

        // Recovery still succeeds (ECDSA.recover always returns *some* address
        // for a valid 65-byte sig with low-s), but the recovered address is NOT
        // the original signer — proving the result is bound to the signature.
        assertTrue(recovered != signerAddr);
        assertEq(got, tamperedResult);
    }

    function test_verify_recoversWrongSignerOnDifferentTarget() public {
        uint256 signerKey = 0xA11CE;
        address signerAddr = vm.addr(signerKey);

        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = uint64(block.timestamp + 60);

        // Signer signs for a different target (e.g., a hypothetical other resolver)
        address otherTarget = address(0xBEEF);
        bytes32 hashForOther = SignatureVerifier.makeSignatureHash(otherTarget, expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hashForOther);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes memory response = abi.encode(result, expires, sig);

        // verify() computes the hash with address(this) as target, which is
        // the test contract address — different from otherTarget. So the
        // recovered address is NOT the signer.
        (address recovered, ) = this.callVerify(request, response);
        assertTrue(recovered != signerAddr);
    }

    /// @dev Wrapper so `verify` is called with calldata (it's a `calldata` lib fn).
    function callVerify(bytes calldata request, bytes calldata response)
        external view returns (address, bytes memory)
    {
        return SignatureVerifier.verify(request, response);
    }
}
