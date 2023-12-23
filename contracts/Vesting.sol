// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title Vesting token vesting smart contract
 * @dev Smart contract houses functions to add vesting schedules against project launches that
 * will distribute tokens to investors in a vested manner according to their investment
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

contract Vesting is OwnableUpgradeable, ReentrancyGuardUpgradeable{
    using SafeMathUpgradeable for uint;

    IERC20 public TOKEN;

    // Total number of pools
    uint private poolCount;

    //Vesting Schedule
    struct Pool {
        bool initialized;                  // whether the pool is added and active
        string name;                       // name of the launch
        uint[] releaseTimes;               // array holding release time stamps
        uint[] releaseAmountPercentage;    // array holding rates of token to be released
        uint totalPoolTokenAmount;         // total reward pool for the schedule
        uint lockedPoolTokens;             // total number of tokens to be distributed to investors
    }

    //Data of a beneficiary address for a specific vesting pool
    struct Beneficiary {
        uint investment;    // investment made by a beneficiary
        uint currentIndex;  // the current position in the release arrays
        uint claimed;       // total number of tokens claimed
        bool status;        // whitelist status of the beneficiary for a launch
        bool rewarded;      // whether all releases have been claimed
    }

    //Total investments, claims and beneficiaries involved for a specific pool
    struct Investment {
        address[] investors;        // array of all investor addresses for a launch
        uint totalInvestment;       // total investment raised
        uint totalTokensClaimed;    // total tokens claimed
        uint totalInvestors;        // total number of investors
    }

    /* Mappings */

    mapping(string => bool) private poolNameStatus;       // Pool name => status

    mapping(string => uint) public poolIndices;           // Pool name => pool index

    mapping(uint => Pool) public vestingPools;            // Pool index => Pool{}

    mapping(uint => Investment) private poolInvestments;  // Pool index => Investment
    
    // Pool index => beneficiary address => Beneficiary{}
    mapping(address => mapping(uint => Beneficiary)) private beneficiaries;

    /* Events */

    /// @notice event emitted when an investor claims their project tokens
    event Claim(address indexed from, uint indexed poolIndex, uint tokenAmount);

    /// @notice event emitted when the owner adds a vesting schedule
    event VestingPoolAdded(uint indexed poolIndex, uint totalPoolTokenAmount);

    /// @notice event emitted when an investor invests in a project and gets added to the beneficiary list
    event BeneficiaryAdded(uint indexed poolIndex, address indexed beneficiary, uint addedTokenAmount);
    
    /* Modifiers */

    /**
    * @notice Checks whether the address is not zero.
    */
    modifier addressNotZero(address _address) {
        require(
            _address != address(0),
            "Vesting: zero address"
        );
        _;
    }

    /**
    * @notice Checks whether the given pool index points to an existing pool.
    */
    modifier poolExists(uint _poolIndex) {
        require(
           vestingPools[_poolIndex].initialized,
            "Vesting: pool does not exist"
        );
        _;
    }

    /**
    * @notice Checks whether the new pool's name already exist.
    */
    modifier nameDoesNotExist(string memory _name) {
        require( 
            !poolNameStatus[_name], 
            "Vesting: name already exists");
        _;
    }
    
    /**
    * @notice Checks whether token amount > 0.
    */
    modifier tokenAmountNotZero(uint _tokenAmount) {
        require(
            _tokenAmount > 0,
            "Vesting: zero token amount"
        );
        _;
    }

    /**
    * @notice Checks whether the address is beneficiary of the pool.
    */
    modifier onlyBeneficiary(uint _poolIndex) {
        require(
            beneficiaries[msg.sender][_poolIndex].status,
            "Vesting: not whitelisted"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {
    /**
     * @dev Locks the contract, preventing any future reinitialization. This cannot be part of an initializer call.
     * Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized
     * to any version.
     * Emits an {Initialized} event the first time it is successfully executed.
     */
        _disableInitializers();
    }

    /**
     * @dev A protected initializer function that can be invoked at most once.
     * @param token address of the token that needs to be vested
     * Emits an {Initialized} event.
     */
    function initialize(IERC20 token) 
        public
        initializer

    {
        __Ownable_init();
        __ReentrancyGuard_init();
        TOKEN = token;
    }

    /* Owner Functions */

    /**
    * @notice Adds new vesting pool.
    * @param name Vesting pool name, Project ID created in Launchpad.
    * @param releaseTimes Array of timestamps corresponding to release.
    * @param releaseAmountPercentage Array of release percentages.
    * @param totalPoolTokenAmount Allocated tokens for a specific pool, Target fund for project.
    */
    function addVestingPool (
        string memory name,
        uint[] memory releaseTimes,
        uint[] memory releaseAmountPercentage,
        uint totalPoolTokenAmount)
        external
        onlyOwner
        nameDoesNotExist(name)
        tokenAmountNotZero(totalPoolTokenAmount)
    {
        require(
            releaseAmountPercentage.length == releaseTimes.length,
            "Vesting: unmatched release array lengths"
        );
        uint totalPercent = 0;
        vestingPools[poolCount].initialized = true;
        poolNameStatus[name] = true;
        poolIndices[name] = poolCount;
        vestingPools[poolCount].name = name;

        for (uint i = 0; i < releaseTimes.length; i++) {
            require(
                releaseTimes[i] > block.timestamp,
                "Vesting: release time should be in the future"
            );
        }    
        vestingPools[poolCount].releaseTimes = releaseTimes;

        for (uint i = 0; i < releaseAmountPercentage.length; i++) {
            totalPercent += releaseAmountPercentage[i];
        }    
        require(
            totalPercent == 100,
            "Vesting: release percentages should add upto 100"
        );
        vestingPools[poolCount].releaseAmountPercentage = releaseAmountPercentage;

        vestingPools[poolCount].totalPoolTokenAmount = totalPoolTokenAmount;

        poolCount++;

        emit VestingPoolAdded(poolCount - 1, totalPoolTokenAmount);
    }

   /**
    * @notice Adds addresses with invested token amounts to the beneficiary list.
    * @param poolIndex Index that refers to vesting pool object.
    * @param addresses List of whitelisted addresses.
    * @param tokenAmount Purchased token absolute amount (with included decimals).
    * @dev Example of parameters: ["address1","address2"], ["address1Amount", "address2Amount"].
    */
    function addToBeneficiariesListMultiple(
        uint poolIndex,
        address[] calldata addresses,
        uint[] calldata tokenAmount)
        external
        onlyOwner
    {
        require(
            addresses.length == tokenAmount.length, 
            "Vesting: address and investment array sizes are different."
            );

        for (uint i = 0; i < addresses.length; i++) {
           addToBeneficiariesList(poolIndex, addresses[i], tokenAmount[i]);
        }
    }

    /**
    * @notice Gives an investor beneficiary status of a project after getting whitelisted.
    * @param poolIndex Index that refers to vesting pool object.
    * @param beneficiary Address of beneficiary.
    */
    function addToWhitelist(uint poolIndex, address beneficiary)
        public
        onlyOwner
        addressNotZero(beneficiary)
    {
        beneficiaries[beneficiary][poolIndex].status = true;
    }

    /**
    * @notice Gives multiple addresses beneficiary status after getting whitelisted.
    * @param poolIndex Index that refers to vesting pool object.
    * @param whitelists Array of whitelisted investors' addresses.
    */
    function uploadWhitelist(uint poolIndex, address[] memory whitelists) 
        external
        onlyOwner 
    {
        for(uint i=0; i<whitelists.length; i++ ){
            addToWhitelist( poolIndex, whitelists[i]);
        }
    }

    /**
    * @notice Transfers tokens to the selected recipient.
    * @dev only owner can call this function
    * @param address_ Address of the recipient.
    * @param tokenAmount Absolute token amount.
    */
    function withdrawContractTokens( 
        address address_, 
        uint256 tokenAmount)
        external 
        onlyOwner 
        addressNotZero(address_) 
    {
        require(TOKEN.transfer(address_, tokenAmount),
            "Vesting: token transfer failed"
        );
    }
    /* Owner Functions end */

    /* Investor Functions */

    /**
    * @notice Adds address with invested token amount to vesting pool.
    * @param poolIndex Index that refers to vesting pool object.
    * @param address_ Address of the beneficiary wallet.
    * @param tokenAmount Invested token amount (incl. decimals).
    */
    function addToBeneficiariesList(
        uint poolIndex,
        address address_,
        uint tokenAmount)
        public
        onlyBeneficiary(poolIndex)
        addressNotZero(address_)
        poolExists(poolIndex)
        tokenAmountNotZero(tokenAmount)
    {
        // Pool storage p = vestingPools[_poolIndex];
        uint totalPoolAmount = vestingPools[poolIndex].totalPoolTokenAmount;
        require(
            totalPoolAmount >= (vestingPools[poolIndex].lockedPoolTokens + tokenAmount),
            "Vesting: allocated token amount will exceed total pool amount"
        );
        if(beneficiaries[address_][poolIndex].investment == 0){
            poolInvestments[poolIndex].totalInvestors++;
            poolInvestments[poolIndex].investors.push(address_);
        }

        vestingPools[poolIndex].lockedPoolTokens += tokenAmount;
        poolInvestments[poolIndex].totalInvestment += tokenAmount;
        beneficiaries[address_][poolIndex].investment += tokenAmount;

        emit BeneficiaryAdded(poolIndex, address_, tokenAmount);
    }

    /**
    * @notice Function lets caller claim unlocked tokens from specified vesting pool.
    * @param poolIndex Index that refers to vesting pool object.
    */
    function claimTokens(uint poolIndex)
        external
        nonReentrant
        poolExists(poolIndex)
        addressNotZero(msg.sender)
        onlyBeneficiary(poolIndex)
    {
        require(
            !beneficiaries[msg.sender][poolIndex].rewarded,
            "Vesting: all releases claimed"
        );
        uint unlockedTokens;
        uint releaseTime;

        (releaseTime,unlockedTokens) = getNextReleaseTimeAndAmount(poolIndex, msg.sender);

        uint releaseTimeInSeconds = releaseTime/1000;

        require(
            unlockedTokens > 0 && releaseTimeInSeconds >0, 
            "Vesting: no pending releases"
        );

        require(
            block.timestamp >= releaseTimeInSeconds,
            "Vesting: time for next release not reached yet."
        );

        require(
            unlockedTokens > 0, 
            "Vesting: no claimable tokens in this schedule."
        );
        require(
            unlockedTokens <= TOKEN.balanceOf(address(this)),
            "Vesting: not enough tokens in the contract."
        );
        poolInvestments[poolIndex].totalTokensClaimed += unlockedTokens;
        beneficiaries[msg.sender][poolIndex].claimed += unlockedTokens;
        beneficiaries[msg.sender][poolIndex].currentIndex += 1;
        if(beneficiaries[msg.sender][poolIndex].currentIndex >=
            vestingPools[poolIndex].releaseTimes.length){
                beneficiaries[msg.sender][poolIndex].rewarded = true;
            }

        require(TOKEN.transfer(msg.sender, unlockedTokens),
            "Vesting: token transfer failed"
        );
        
        emit Claim(msg.sender, poolIndex, unlockedTokens);
    }

    /* Investor Functions end */
  
    /* View Functions */

    /**
    * @notice Checks how many tokens unlocked in a pool (not allocated to any user).
    * @param poolIndex Index that refers to vesting pool object.
    */
    function totalUnlockedPoolTokens(uint poolIndex) 
        external
        view
        returns (uint)
    {
        return vestingPools[poolIndex].totalPoolTokenAmount - vestingPools[poolIndex].lockedPoolTokens;
    }

    /**
    * @notice View of the beneficiary structure.
    * @param poolIndex Index that refers to vesting pool object.
    * @param address_ Address of the beneficiary wallet.
    * @return Beneficiary structure information.
    */
    function beneficiaryInformation(uint poolIndex, address address_)
        external
        view
        poolExists(poolIndex)
        returns (Beneficiary memory)
    {
        return(beneficiaries[address_][poolIndex]);
    }

    /**
    * @notice View of next release time and amount for a beneficiary in a given pool.
    * @param poolIndex Index that refers to vesting pool object.
    * @param address_ Address of the beneficiary wallet.
    * @return uint Next release time.
    * @return uint Next release amount.
    */
    function getNextReleaseTimeAndAmount(uint poolIndex, address address_)
        public
        view
        returns (uint, uint)
    {
        Pool memory vestingPool = vestingPools[poolIndex];
        uint currentVestingIndex = beneficiaries[address_][poolIndex].currentIndex;

        if(currentVestingIndex >= vestingPool.releaseTimes.length){
            return(0,0);
        }
        else {
            uint percentage = vestingPool.releaseAmountPercentage[currentVestingIndex];
            uint multiplier = percentage * 100;

            uint nextReleaseTime = vestingPool.releaseTimes[currentVestingIndex];
            uint nextReleaseAmount = (beneficiaries[address_][poolIndex].investment*multiplier)/10000;
            return (nextReleaseTime,nextReleaseAmount);
        } 
    }

    /**
    * @notice Return number of pools in contract.
    * @return uint pool count.
    */
    function getPoolCount() 
        external
        view
        returns (uint)
    {
        return poolCount;
    }

    /**
    * @notice Return claimable token address
    * @return IERC20 token.
    */
    function getToken() 
        external
        view
        returns (IERC20)
    {
        return TOKEN;
    }
    
    /**
    * @notice Returns pool index of a project.
    * @param name Name of the project (ProjectID).
    * @return uint Vesting pool index.
    */
    function getPoolIndex(string memory name)
        external
        view
        returns (uint)
    {
        return(poolIndices[name]);
    }

    /**
    * @notice View of the vesting pool structure.
    * @param poolIndex Index that refers to vesting pool object.
    * @return Vesting pool information.
    */
    function poolData(uint poolIndex)
        external
        poolExists(poolIndex)
        view
        returns (
            Pool memory
        )
    {
        return(vestingPools[poolIndex]);        
    }

     /**
    * @notice View of the Investment structure.
    * @param poolIndex Index that refers to Investment object.
    * @return Investment struct information.
    */
    function getInvestmentData(uint poolIndex)
    external
    view
    returns (Investment memory)
    {
        return(poolInvestments[poolIndex]);
    }
    /* View Functions end */
}