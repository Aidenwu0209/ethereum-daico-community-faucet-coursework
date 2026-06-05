// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CommunityToken} from "./CommunityToken.sol";

contract CommunityDAICO is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

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

    CommunityToken public immutable token;
    IERC20 private immutable safeToken;

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

    uint256 private proposalCounter;

    mapping(address => uint256) public investments;
    mapping(address => uint256) public lastClaimTime;
    mapping(uint256 => Proposal) private proposals;
    mapping(uint256 => mapping(address => bool)) private proposalVotes;

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

        token = CommunityToken(tokenAddress);
        safeToken = IERC20(tokenAddress);
        fundingGoal = goal;
        fundingStart = block.timestamp;
        fundingDeadline = block.timestamp + duration;
        tokenRate = rate;
        faucetClaimAmount = initialFaucetClaimAmount;
        faucetCooldown = 24 hours;
        faucetEnabled = true;
    }

    receive() external payable {
        invest();
    }

    function invest() public payable nonReentrant {
        require(getFundingStatus() == FundingStatus.Active, "Funding is not active");
        require(msg.value > 0, "Investment must be greater than zero");

        uint256 tokenAmount = msg.value * tokenRate;
        uint256 faucetReserve = (tokenAmount * FAUCET_RESERVE_PERCENT) / (100 - FAUCET_RESERVE_PERCENT);

        raisedAmount += msg.value;
        investments[msg.sender] += msg.value;
        faucetPoolBalance += faucetReserve;

        token.mint(msg.sender, tokenAmount);
        token.mint(address(this), faucetReserve);

        emit Invested(msg.sender, msg.value, tokenAmount, faucetReserve);
    }

    function finalizeFunding() external {
        require(block.timestamp >= fundingDeadline, "Funding period has not ended");
        require(!fundingFinalized, "Funding already finalized");

        fundingFinalized = true;
        fundingSuccessful = raisedAmount >= fundingGoal;

        if (fundingSuccessful) {
            treasuryBalance = raisedAmount;
        }

        token.closeMinting();

        emit FundingFinalized(fundingSuccessful, raisedAmount, treasuryBalance);
    }

    function refund() external nonReentrant {
        require(fundingFinalized, "Funding not finalized");
        require(!fundingSuccessful, "Funding was successful");

        uint256 amount = investments[msg.sender];
        require(amount > 0, "No refundable investment");

        investments[msg.sender] = 0;

        emit Refunded(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Refund transfer failed");
    }

    function claimFaucet() external nonReentrant {
        require(fundingFinalized && fundingSuccessful, "Funding must be successful");
        require(faucetEnabled, "Faucet is disabled");
        require(token.balanceOf(msg.sender) >= MIN_TOKEN_TO_CLAIM, "Insufficient token balance");
        require(block.timestamp >= getNextClaimTime(msg.sender), "Faucet cooldown active");
        require(faucetPoolBalance >= faucetClaimAmount, "Faucet pool is insufficient");

        faucetPoolBalance -= faucetClaimAmount;
        lastClaimTime[msg.sender] = block.timestamp;

        safeToken.safeTransfer(msg.sender, faucetClaimAmount);

        emit FaucetClaimed(msg.sender, faucetClaimAmount, getNextClaimTime(msg.sender));
    }

    function createProposal(
        ProposalType proposalType,
        string calldata description,
        uint256 newValue,
        address payable recipient
    ) external returns (uint256) {
        require(fundingFinalized && fundingSuccessful, "Funding must be successful");
        require(bytes(description).length > 0, "Description required");
        require(_canCreateProposal(msg.sender), "Proposal threshold not met");

        if (proposalType == ProposalType.ChangeFaucetAmount) {
            require(newValue > 0, "Faucet amount must be greater than zero");
        } else if (proposalType == ProposalType.ChangeFaucetCooldown) {
            require(newValue > 0 && newValue <= MAX_COOLDOWN, "Invalid cooldown");
        } else if (proposalType == ProposalType.ToggleFaucet) {
            require(newValue <= 1, "Toggle value must be 0 or 1");
        } else if (proposalType == ProposalType.WithdrawTreasury) {
            require(newValue > 0, "Withdraw amount must be greater than zero");
            require(recipient != address(0), "Recipient cannot be zero");
        }

        proposalCounter += 1;
        uint256 proposalId = proposalCounter;
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + VOTING_DURATION;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposalType: proposalType,
            proposer: msg.sender,
            description: description,
            newValue: newValue,
            recipient: recipient,
            startTime: startTime,
            endTime: endTime,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            canceled: false,
            totalSupplyAtCreation: token.totalSupply()
        });

        emit ProposalCreated(proposalId, proposalType, msg.sender, description, newValue, recipient, startTime, endTime);

        return proposalId;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = _proposalOrRevert(proposalId);
        require(!proposal.canceled, "Proposal is canceled");
        require(block.timestamp < proposal.endTime, "Voting period ended");
        require(!proposalVotes[proposalId][msg.sender], "Already voted");

        uint256 weight = token.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        proposalVotes[proposalId][msg.sender] = true;

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = _proposalOrRevert(proposalId);
        require(!proposal.canceled, "Proposal is canceled");
        require(!proposal.executed, "Proposal already executed");
        require(block.timestamp >= proposal.endTime, "Voting period not ended");
        require(_isProposalPassed(proposal), "Proposal did not pass");

        proposal.executed = true;

        if (proposal.proposalType == ProposalType.ChangeFaucetAmount) {
            uint256 previousAmount = faucetClaimAmount;
            faucetClaimAmount = proposal.newValue;
            emit FaucetAmountChanged(previousAmount, proposal.newValue);
            emit ProposalExecuted(proposalId, true);
        } else if (proposal.proposalType == ProposalType.ChangeFaucetCooldown) {
            uint256 previousCooldown = faucetCooldown;
            faucetCooldown = proposal.newValue;
            emit FaucetCooldownChanged(previousCooldown, proposal.newValue);
            emit ProposalExecuted(proposalId, true);
        } else if (proposal.proposalType == ProposalType.ToggleFaucet) {
            faucetEnabled = proposal.newValue == 1;
            emit FaucetStatusChanged(faucetEnabled);
            emit ProposalExecuted(proposalId, true);
        } else {
            require(proposal.newValue <= treasuryBalance, "Insufficient treasury balance");
            treasuryBalance -= proposal.newValue;
            emit ProposalExecuted(proposalId, true);

            (bool success, ) = proposal.recipient.call{value: proposal.newValue}("");
            require(success, "Treasury transfer failed");
        }
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage proposal = _proposalOrRevert(proposalId);
        require(msg.sender == proposal.proposer || msg.sender == owner(), "Not authorized to cancel");
        require(!proposal.executed, "Proposal already executed");
        require(!proposal.canceled, "Proposal already canceled");
        require(block.timestamp < proposal.endTime, "Voting period ended");

        proposal.canceled = true;

        emit ProposalCancelled(proposalId);
    }

    function getFundingStatus() public view returns (FundingStatus) {
        if (fundingFinalized) {
            return FundingStatus.Finalized;
        }

        if (block.timestamp < fundingDeadline) {
            return FundingStatus.Active;
        }

        if (raisedAmount >= fundingGoal) {
            return FundingStatus.Successful;
        }

        return FundingStatus.Failed;
    }

    function getRaisedAmount() external view returns (uint256) {
        return raisedAmount;
    }

    function getRemainingTime() public view returns (uint256) {
        if (block.timestamp >= fundingDeadline) {
            return 0;
        }

        return fundingDeadline - block.timestamp;
    }

    function getFaucetInfo()
        external
        view
        returns (uint256 poolBalance, uint256 claimAmount, uint256 cooldown, bool enabled)
    {
        return (faucetPoolBalance, faucetClaimAmount, faucetCooldown, faucetEnabled);
    }

    function getNextClaimTime(address user) public view returns (uint256) {
        require(user != address(0), "User cannot be zero");
        return lastClaimTime[user] + faucetCooldown;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposalOrRevertView(proposalId);
    }

    function getProposalCount() external view returns (uint256) {
        return proposalCounter;
    }

    function hasVoted(uint256 proposalId, address user) external view returns (bool) {
        require(user != address(0), "User cannot be zero");
        _proposalOrRevertView(proposalId);
        return proposalVotes[proposalId][user];
    }

    function getTreasuryBalance() external view returns (uint256) {
        return treasuryBalance;
    }

    function canCreateProposal(address user) external view returns (bool) {
        require(user != address(0), "User cannot be zero");
        return _canCreateProposal(user);
    }

    function isProposalPassed(uint256 proposalId) external view returns (bool) {
        Proposal storage proposal = _proposalOrRevertView(proposalId);
        return _isProposalPassed(proposal);
    }

    function _proposalOrRevert(uint256 proposalId) private view returns (Proposal storage) {
        require(proposalId > 0 && proposalId <= proposalCounter, "Proposal does not exist");
        return proposals[proposalId];
    }

    function _proposalOrRevertView(uint256 proposalId) private view returns (Proposal storage) {
        require(proposalId > 0 && proposalId <= proposalCounter, "Proposal does not exist");
        return proposals[proposalId];
    }

    function _canCreateProposal(address user) private view returns (bool) {
        if (user == owner()) {
            return true;
        }

        uint256 supply = token.totalSupply();
        if (supply == 0) {
            return false;
        }

        return token.balanceOf(user) * 100 >= supply * PROPOSAL_THRESHOLD_PERCENT;
    }

    function _isProposalPassed(Proposal storage proposal) private view returns (bool) {
        if (proposal.canceled || proposal.totalSupplyAtCreation == 0) {
            return false;
        }

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        if (totalVotes == 0) {
            return false;
        }

        bool quorumReached = totalVotes * 100 >= proposal.totalSupplyAtCreation * QUORUM_PERCENT;
        bool supportReached = proposal.forVotes * 100 >= totalVotes * SUPPORT_PERCENT;

        return quorumReached && supportReached;
    }
}
