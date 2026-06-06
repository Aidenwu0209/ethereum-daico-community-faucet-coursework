// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICommunityToken} from "../interfaces/ICommunityToken.sol";

abstract contract DAICOBase is Ownable, ReentrancyGuard {
    uint256 public constant FAUCET_RESERVE_PERCENT = 10;
    uint256 public constant MIN_TOKEN_TO_CLAIM = 1 ether;
    uint256 public constant PROPOSAL_THRESHOLD_PERCENT = 5;
    uint256 public constant QUORUM_PERCENT = 20;
    uint256 public constant SUPPORT_PERCENT = 51;
    uint256 public constant VOTING_DURATION = 72 hours;
    uint256 public constant MAX_COOLDOWN = 30 days;

    enum FundingStatus {
        Active,
        Failed,
        Successful,
        Finalized
    }

    enum ProposalType {
        ChangeFaucetAmount,
        ChangeFaucetCooldown,
        ToggleFaucet,
        WithdrawTreasury
    }

    struct Proposal {
        uint256 id;
        ProposalType proposalType;
        address proposer;
        string description;
        uint256 newValue;
        address payable recipient;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool canceled;
        uint256 totalSupplyAtCreation;
    }

    ICommunityToken public immutable token;
    IERC20 internal immutable safeToken;

    uint256 public immutable fundingGoal;
    uint256 public immutable fundingStart;
    uint256 public immutable fundingDeadline;
    uint256 public immutable tokenRate;

    uint256 public raisedAmount;
    uint256 public treasuryBalance;
    bool public fundingFinalized;
    bool public fundingSuccessful;

    uint256 public faucetPoolBalance;
    uint256 public faucetClaimAmount;
    uint256 public faucetCooldown;
    bool public faucetEnabled;

    uint256 internal proposalCounter;

    mapping(address => uint256) public investments;
    mapping(address => uint256) public lastClaimTime;
    mapping(uint256 => Proposal) internal proposals;
    mapping(uint256 => mapping(address => bool)) internal proposalVotes;

    event Invested(address indexed investor, uint256 ethAmount, uint256 tokenAmount, uint256 faucetReserve);
    event FundingFinalized(bool successful, uint256 raisedAmount, uint256 treasuryBalance);
    event Refunded(address indexed investor, uint256 amount);
    event FaucetClaimed(address indexed user, uint256 amount, uint256 nextClaimTime);
    event FaucetAmountChanged(uint256 previousAmount, uint256 newAmount);
    event FaucetCooldownChanged(uint256 previousCooldown, uint256 newCooldown);
    event FaucetStatusChanged(bool enabled);
    event ProposalCreated(
        uint256 indexed proposalId,
        ProposalType indexed proposalType,
        address indexed proposer,
        string description,
        uint256 newValue,
        address recipient,
        uint256 startTime,
        uint256 endTime
    );
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId, bool successful);
    event ProposalCancelled(uint256 indexed proposalId);

    constructor(
        address tokenAddress,
        uint256 goal,
        uint256 duration,
        uint256 rate,
        uint256 initialFaucetClaimAmount
    ) Ownable(msg.sender) {
        require(tokenAddress != address(0), "Token cannot be zero");
        require(goal > 0, "Funding goal must be greater than zero");
        require(duration > 0, "Funding duration must be greater than zero");
        require(rate > 0, "Token rate must be greater than zero");
        require(initialFaucetClaimAmount > 0, "Faucet amount must be greater than zero");

        token = ICommunityToken(tokenAddress);
        safeToken = IERC20(tokenAddress);
        fundingGoal = goal;
        fundingStart = block.timestamp;
        fundingDeadline = block.timestamp + duration;
        tokenRate = rate;
        faucetClaimAmount = initialFaucetClaimAmount;
        faucetCooldown = 24 hours;
        faucetEnabled = true;
    }
}
