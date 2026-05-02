// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { OurOffchainResolver } from "../src/OurOffchainResolver.sol";

/// @notice Deploys OurOffchainResolver to Ethereum mainnet.
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $MAINNET_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
contract DeployScript is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address gatewaySigner = vm.envAddress("GATEWAY_SIGNER_ADDRESS");

        // ENS gateway URLs use {sender} and {data} placeholders per ERC-3668.
        string[] memory urls = new string[](1);
        urls[0] = string.concat(gatewayUrl, "/resolve/{sender}/{data}.json");

        address[] memory signers = new address[](1);
        signers[0] = gatewaySigner;

        vm.startBroadcast();
        OurOffchainResolver resolver = new OurOffchainResolver(urls, signers);
        vm.stopBroadcast();

        console.log("OurOffchainResolver deployed at:", address(resolver));
        console.log("Gateway URL:", urls[0]);
        console.log("Authorized signer:", signers[0]);
        console.log("");
        console.log("Next: run script/SetGabhruResolver.s.sol after gateway is live and reachable.");
    }
}
