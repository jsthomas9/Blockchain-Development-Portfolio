// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20 {
    constructor() ERC20("Token", "TPS") {
        _mint(msg.sender, 100 * 10**uint256(decimals()));
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
