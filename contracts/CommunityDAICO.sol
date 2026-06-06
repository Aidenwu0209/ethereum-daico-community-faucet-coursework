// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DAICOBase} from "./modules/DAICOBase.sol";
import {DAICOGovernance} from "./modules/DAICOGovernance.sol";

contract CommunityDAICO is DAICOGovernance {
    constructor(
        address tokenAddress,
        uint256 goal,
        uint256 duration,
        uint256 rate,
        uint256 initialFaucetClaimAmount
    ) DAICOBase(tokenAddress, goal, duration, rate, initialFaucetClaimAmount) {}
}
