// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CommunityToken is ERC20, Ownable {
    address public minter;
    bool public mintingClosed;

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event MintingClosed(address indexed closedBy);

    constructor(address initialOwner)
        ERC20("Community Faucet Token", "CFT")
        Ownable(initialOwner)
    {
        require(initialOwner != address(0), "Owner cannot be zero");
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "Caller is not minter");
        _;
    }

    function setMinter(address newMinter) external onlyOwner {
        require(!mintingClosed, "Minting already closed");
        require(newMinter != address(0), "Minter cannot be zero");

        address previousMinter = minter;
        minter = newMinter;

        emit MinterUpdated(previousMinter, newMinter);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        require(!mintingClosed, "Minting already closed");
        require(to != address(0), "Recipient cannot be zero");
        require(amount > 0, "Amount must be greater than zero");

        _mint(to, amount);
    }

    function closeMinting() external onlyMinter {
        require(!mintingClosed, "Minting already closed");

        mintingClosed = true;

        emit MintingClosed(msg.sender);
    }
}
