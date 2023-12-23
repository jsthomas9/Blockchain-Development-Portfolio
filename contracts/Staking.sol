// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/**
 * @title Staking
 * @dev Smart contract houses 4 vaults into which users can stake their ZMT tokens to earn rewards.
 */
contract Staking is ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct StakeData {
        uint256 stakeAmount; // Stake Amount
        uint256 stakingTime; // First staking time
        uint256 stakeUnlockTime; // Stake Unlock Timestamp
        uint256 rewardPerSecond; // Reward for this stake per second
    }

    // Total stake in the platform
    uint256 private _totalStake;

    // Total expected reward in the platform
    uint256 private _totalExpectedBonus;

    // Total bonus pool amount
    uint256 private _bonusPoolAmount;

    // Bonus pool amount threshold
    uint256 private _bonusPoolThreshold;

    // Owner of the contract
    address private _owner;

    // Token contract address
    IERC20Upgradeable private _tokenAddress;

    // Potential owner's address
    address private _potentialOwner;

    // Penalty percentage
    uint256 private _penaltyRate; // 10000 max

    // Penalties collected by the platform
    uint256 private _collectedPenalties;

    // locking period vaults
    uint256[4] private _vaults;

    /* Mappings */

    // staker address => vault => StakeData
    mapping(address => mapping(uint256 => StakeData)) private _stakeData;
    // vault => reward rate
    mapping(uint256 => uint256) private _rewardRate;
    // staker => vault => exist or not
    mapping(address => mapping(uint256 => bool)) private _stakeExist;
    // staker address => vault => last claim time
    mapping(address => mapping(uint256 => uint256)) private _claimTime;
    // staker address => vault => vault rate
    mapping(address => mapping(uint256 => uint256)) private _stakeRate;

    /* Events */
    /// @notice event emitted when a potential owner is added
    event NominateOwner(address indexed potentialOwner);

    /// @notice event emitted when a potential owner accepts ownership
    event OwnerChanged(address indexed newOwner);

    /// @notice event emitted when a user stakes
    event Stake(
        address indexed staker,
        uint256 vault,
        uint256 amount,
        uint256 rewardPerSecond,
        uint256 unStakeTime,
        uint256 reward
    );

    /// @notice event emitted when a user unstakes
    event UnStake(
        address indexed staker,
        uint256 vault,
        uint256 amount,
        uint256 penalty,
        uint256 reward
    );

    /// @notice event emitted when owner withdraws token balance
    event BalanceWithdraw(address indexed owner, uint256 balance);

    /// @notice event emitted when owner withdraws tokens collected as penalty
    event PenaltyWithdraw(address indexed owner, uint256 penaltyAmount);

    /// @notice event emitted penalty rate is changed
    event PenaltyRateChanged(uint256 indexed newRate);

    /// @notice event emitted when bonus threshold rate is changed
    event BonusThresholdChanged(uint256 newThreshold);

    /* 
     * @notice event emitted when bonus threshold amount is reached
     * @dev event is captured in the front end to fire e-mail notification for the admin to refill bonus pool
     */
    event BonusThresholdReached(
        uint256 currentPoolBalance,
        uint256 currentExpectedReward
    );

    /// @notice event emitted when owner adds tokens to bonus pool
    event BonusPoolAmountAdded(uint256 amount, uint256 newBalance);

    ///@notice event emitted when rewards are claimed by a user
    event RewardReleased(address indexed staker, uint256 vault, uint256 reward);

    /* 
     * @notice event emitted when admin adds a vault
     * @dev there can be only four APY rates maximum at a time 
     */
    event VaultAdded(
        uint256 indexed vault,
        uint256 indexed lockingPeriod,
        uint256 rewardRate
    );

    /// @notice event emitted when admin changes lock period or APY rate
    event VaultModified(
        uint256 indexed vault,
        uint256 indexed lockingPeriod,
        uint256 rewardRate
    );

    /// @notice event emitted when admin removes a vault
    event VaultRemoved(uint256 indexed vault, uint256 indexed lockingPeriod);

    /* Modifiers */

    /// @notice checks if caller is the owner
    modifier onlyOwner() {
        require(
            _owner == msg.sender,
            "Staking: Only owner can call this function"
        );
        _;
    }

    /// @notice checks if rate falls between 0% and 100%
    modifier checkRate(uint256 rate) {
        require(
            rate > 0 && rate <= 10000,
            "Staking: In-valid fine percentage"
        );
        _;
    }

    /// @notice checks if address is zero address
    modifier checkAddress(address account) {
        require(account != address(0), "Staking: Zero address");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
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
     * @param tokenAddress_ address of token to be staked
     * @param owner_ address of the platform owner
     * @param penaltyRate_ initial rate of penalty fee
     * Emits an {Initialized} event.
     */
    function initialize(
        address tokenAddress_,
        address owner_,
        uint256 penaltyRate_
    )
        external
        initializer
        checkRate(penaltyRate_)
        checkAddress(tokenAddress_)
        checkAddress(owner_)
    {
        _tokenAddress = IERC20Upgradeable(tokenAddress_);
        _owner = owner_;
        _penaltyRate = penaltyRate_;
    }

    /* View Methods Start */

    /**
     * @notice This function is used to get All the stake details for a user
     * @param account address of the staker
     * @return stakeData stake records for all vaults
     * @return totalReward total rewards for all vaults
     * @return claimableReward claimable rewards for all vaults
     */
    function getAllStakes(address account)
        external
        view
        returns (
            StakeData[4] memory stakeData,
            uint256[4] memory totalReward,
            uint256[4] memory claimableReward
        )
    {
        for (uint256 i = 0; i < 4; i++) {
            if (!_stakeExist[account][i]) continue;
            (stakeData[i], totalReward[i], claimableReward[i]) = getStake(
                account,
                i
            );
        }
    }

    /**
     * @notice This function is used to get Stake's details for a particular vault
     * @param account address of the staker
     * @param vault vault number of the stake
     * @return stakeData stake record for the particular vault
     * @return totalReward total rewards for the particular vault
     * @return claimableReward claimable rewards for the particular vault
     */
    function getStake(address account, uint256 vault)
        public
        view
        returns (
            StakeData memory stakeData,
            uint256 totalReward,
            uint256 claimableReward
        )
    {
        require(
            _stakeExist[account][vault],
            "Staking: Stake does not exist for the staker for this vault"
        );
        // stake record
        stakeData = _stakeData[account][vault];

        // total reward per vault
        totalReward = _getTotalReward(
            stakeData.rewardPerSecond,
            (stakeData.stakeUnlockTime - stakeData.stakingTime)
        );

        // claimable reward per vault
        claimableReward = _getTotalReward(
            stakeData.rewardPerSecond,
            _getInterval(stakeData.stakeUnlockTime, _claimTime[account][vault])
        );
    }

    /**
     * @notice This function is used to get Total staked amount a particular account
     * @param account address of the staker
     * @return totalStake_ total staked amount from all the vaults
     */
    function getTotalStake(address account)
        external
        view
        returns (uint256 totalStake_)
    {
        for (uint256 i; i < 4; i++) {
            totalStake_ += _stakeData[account][i].stakeAmount;
        }
    }

    /**
     * @notice This function is used to get all the vault's details
     * @return lockingPeriod all durations for staking in seconds
     * @return rewardRate all APY rates
     */
    function getAllVaults()
        external
        view
        returns (uint256[4] memory lockingPeriod, uint256[4] memory rewardRate)
    {
        for (uint256 i; i < 4; i++) {
            rewardRate[i] = _rewardRate[i];
        }
        lockingPeriod = _vaults;
    }

    /**
     * @notice This function is used to get a particular vault's details
     * @param vault index of the vault to query
     * @return lockingPeriod locking duration of the particular vault in seconds
     * @return rewardRate APY rate of the particular vault
     */
    function getVault(uint256 vault)
        external
        view
        returns (uint256 lockingPeriod, uint256 rewardRate)
    {
        lockingPeriod = _vaults[vault];
        rewardRate = _rewardRate[vault];
    }

    /**
     * @notice This function is used to get the penalty percentage
     * @return _penaltyRate penalty rate of the platform
     */
    function penaltyRate() external view returns (uint256) {
        return _penaltyRate;
    }

    /**
     * @notice This function is used to get the contract owner's address
     * @return Address of the contract owner
     */
    function owner() external view returns (address) {
        return _owner;
    }

    /**
     * @notice This function is used to get the potential owner's address
     * @return Address of the potential owner
     */
    function potentialOwner() external view returns (address) {
        return _potentialOwner;
    }

    /**
     * @notice This function is used to get the total staked amount
     * @return _totalStake total tokens staked in the platform
     */
    function totalStake() external view returns (uint256) {
        return _totalStake;
    }

    /**
     * @notice This function is used to get the total expected reward (bonus) amount
     * @return _totalExpectedBonus expected rewards to be distributed
     */
    function totalExpectedBonus() external view returns (uint256) {
        return _totalExpectedBonus;
    }

    /**
     * @notice This function is used to get the remaining bonus pool amount
     * @return _bonusPoolAmount reward pool supply of the platform
     */
    function bonusPoolAmount() external view returns (uint256) {
        return _bonusPoolAmount;
    }

    /**
     * @notice This function is used to get the bonus pool threshold
     * @return _bonusPoolThreshold bonus pool threshold rate of the platform
     */
    function bonusPoolThreshold() external view returns (uint256) {
        return _bonusPoolThreshold;
    }

    /**
     * @notice This function is used to get the total collected penalties
     * @return _collectedPenalties tokens collected by the owner as penalties
     */
    function collectedPenalties() external view returns (uint256) {
        return _collectedPenalties;
    }

    /**
     * @notice This function is used to get the token address
     * @return _tokenAddress address of the token
     */
    function tokenAddress() external view returns (IERC20Upgradeable) {
        return _tokenAddress;
    }

    /**
     * @notice This function is used to get the last claim time
     * @param _account address of the user
     * @param _vault vault with the stake
     * @return last claim time of an address for a vault
     */
    function getLastClaimTime(address _account, uint256 _vault)
        external
        view
        returns (uint256)
    {
        return _claimTime[_account][_vault];
    }

    /**
     * @notice This function is used to check if an invested vault has been modified
     * @param _account address of the user
     * @param _vault vault with the stake
     * @return bool whether a vault has been modified or not
     */
    function isVaultModified(address _account, uint256 _vault)
        external
        view
        returns (bool)
    {
        return _stakeRate[_account][_vault] != _rewardRate[_vault];
    }

    /* View Methods End */

    /* Owner Methods Start */

    /**
     * @notice This function is used to add a vault's Locking period and reward percentage
     * @dev Only the owner can call this function
     * @param rewardRate reward rate to be set
     * @param lockingPeriod Locking period in seconds
     * @param vault vault number
     */
    function addVault(
        uint256 vault,
        uint256 lockingPeriod,
        uint256 rewardRate
    ) external onlyOwner checkRate(rewardRate) {
        require(vault < 4, "Staking: Invalid vault");
        require(_rewardRate[vault] == 0, "Staking: Vault exist");

        _vaults[vault] = lockingPeriod;
        _rewardRate[vault] = rewardRate;
        emit VaultAdded(vault, lockingPeriod, rewardRate);
    }

    /**
     * @notice This function is used to modify reward rate or locking period for a particular vault
     * @dev Only the owner can call this function
     * @param rewardRate reward rate to be set
     * @param lockingPeriod Locking period in seconds
     * @param vault vault number to be modified
     */
    function modifyVault(
        uint256 vault,
        uint256 lockingPeriod,
        uint256 rewardRate
    ) external onlyOwner checkRate(rewardRate) {
        _checkVault(vault);

        _vaults[vault] = lockingPeriod;
        _rewardRate[vault] = rewardRate;
        emit VaultModified(vault, lockingPeriod, rewardRate);
    }

    /**
     * @notice This function is used to remove a particular vault
     * @dev Only the owner can call this function
     * @param vault vault number to be removed
     */
    function removeVault(uint256 vault) external onlyOwner {
        _checkVault(vault);

        uint256 lockingPeriod = _vaults[vault];
        _vaults[vault] = 0;
        delete _rewardRate[vault];

        emit VaultRemoved(vault, lockingPeriod);
    }

    /**
     * @notice This function is used to change penalty rate
     * @dev Only the owner can call this function
     * @param penaltyRate_ reward rate to be set
     */
    function changePenaltyRate(uint256 penaltyRate_)
        external
        onlyOwner
        checkRate(penaltyRate_)
    {
        require(
            _penaltyRate != penaltyRate_,
            "Staking: Penalty rate same"
        );

        _penaltyRate = penaltyRate_;
        emit PenaltyRateChanged(penaltyRate_);
    }

    /**
     * @notice This function is used to withdraw all the penalties
     * @dev Only the owner can call this function
     */
    function withdrawPenalties() external onlyOwner nonReentrant {
        require(
            _collectedPenalties > 0,
            "Staking: No penalty has been collected"
        );

        uint256 penaltyToTransfer = _collectedPenalties;
        _collectedPenalties = 0;

        emit PenaltyWithdraw(msg.sender, penaltyToTransfer);
        _tokenAddress.safeTransfer(_owner, penaltyToTransfer);
    }

    /**
     * @notice This function is used to withdraw the tokens in the contract
     * @dev Only the owner can call this function
     * @dev amount after deducting total stake and expected rewards can be withdrawn
     */
    function withdrawBalance() external onlyOwner nonReentrant {
        uint256 balance = _tokenAddress.balanceOf(address(this)) -
            _totalStake -
            _totalExpectedBonus;
        require(balance > 0, "Staking: Zero balance");

        emit BalanceWithdraw(msg.sender, balance);
        _tokenAddress.safeTransfer(_owner, balance);
    }

    /**
     * @notice This function is used to add a potential owner of the contract
     * @dev Only the owner can call this function
     * @param potentialOwner_ Address of the potential owner
     */
    function addPotentialOwner(address potentialOwner_)
        external
        onlyOwner
        checkAddress(potentialOwner_)
    {
        require(
            potentialOwner_ != _owner,
            "Staking: Potential Owner should not be owner"
        );
        require(
            potentialOwner_ != _potentialOwner,
            "Staking: Already a potential owner"
        );
        _potentialOwner = potentialOwner_;
        emit NominateOwner(potentialOwner_);
    }

    /**
     * @notice This function is used to change bonus pool threshold
     * @dev Only the owner can call this function
     * a threshold is set to alert the admin to add tokens to reward pool if the current balance goes
     * below the threshold
     * @param bonusThreshold_ new bonus pool threshold
     */
    function changeBonusPoolThreshold(uint256 bonusThreshold_)
        external
        onlyOwner
        checkRate(bonusThreshold_)
    {
        require(
            _bonusPoolThreshold != bonusThreshold_,
            "Staking: Bonus threshold same"
        );

        _bonusPoolThreshold = bonusThreshold_;
        emit BonusThresholdChanged(bonusThreshold_);
    }

    /**
     * @notice This function is used to add bonus pool amount
     * @dev Only the owner can call this function
     * @param amount_ amount to be added
     */
    function addBonusPoolAmount(uint256 amount_) external onlyOwner {
        _paymentPrecheck(amount_);

        uint256 bonusAmount_ = _bonusPoolAmount;
        bonusAmount_ += amount_;
        _bonusPoolAmount = bonusAmount_;

        emit BonusPoolAmountAdded(amount_, bonusAmount_);
        _tokenAddress.safeTransferFrom(msg.sender, address(this), amount_);
    }

    /* Owner Methods End */

    /* Potential Owner Methods Start */

    /**
     * @notice This function is used to accept ownership of the contract
     * @dev only an address nominated as a potential owner can call this function
     */
    function acceptOwnership() external checkAddress(msg.sender) {
        require(
            msg.sender == _potentialOwner,
            "Staking: Only the potential owner can accept ownership"
        );
        _owner = _potentialOwner;
        _potentialOwner = address(0);
        emit OwnerChanged(_owner);
    }

    /* Potential Owner Methods End */

    /* User Methods Start */

    /**
     * @notice This function is used to stake the coins
     * @dev if the stake for the vault already exist then
     * it should add the amount to the existing stake and
     * release reward till that point and re calcualte the reward with
     * new amount and new unlocking period
     * @dev if unlock is over and amount is zero then we need to restake the
     * previous stake amount
     * @param amount Amount of coins to stake
     * @param vault vault number which represents a particular locking period in seconds
     */
    function stake(uint256 amount, uint256 vault) external nonReentrant {
        _checkVault(vault);

        StakeData memory stakeData = _stakeData[msg.sender][vault];

        //value emits existing amount if restake occurs, else the amount passed
        uint256 amountToEmit; 

        uint256 rewardToTransfer;
        bool unlockOver;
        // check if stake for this vault already exists
        if (_stakeExist[msg.sender][vault]) {
            (, rewardToTransfer, unlockOver) = _getPenaltyAndRewards(
                stakeData,
                _claimTime[msg.sender][vault],
                false
            );
            // check if unlockover; then if amount is zero then consider the previous staked amount
            if (!unlockOver || amount != 0) {
                _paymentPrecheck(amount);
                stakeData.stakeAmount += amount;
            }
        } else {
            _paymentPrecheck(amount);
            stakeData.stakeAmount += amount;
            _stakeExist[msg.sender][vault] = true;
        }

        // update the stake details
        uint256 rewardRate_ = _rewardRate[vault];
        uint256 lockingPeriod = _vaults[vault];
        uint256 rewardPerSecond = _getReward(
            stakeData.stakeAmount,
            rewardRate_
        );
        _stakeRate[msg.sender][vault] = rewardRate_;
        uint256 reward = _getTotalReward(rewardPerSecond, lockingPeriod);
        uint256 totalStake_ = _totalStake;
        uint256 totalReward_ = _totalExpectedBonus;
        totalStake_ += amount;
        totalReward_ += reward;

        // check balance of the contract for the reward amount
        require(
            totalReward_ <= _bonusPoolAmount,
            "Staking: Insufficient balance in bonus pool"
        );

        _claimTime[msg.sender][vault] = block.timestamp;

        stakeData.stakingTime = block.timestamp;
        stakeData.stakeUnlockTime = block.timestamp + lockingPeriod;
        stakeData.rewardPerSecond = rewardPerSecond;
        _stakeData[msg.sender][vault] = stakeData;
        
        _totalStake = totalStake_;
        _totalExpectedBonus = totalReward_;

        if(amount == 0){
            amountToEmit = stakeData.stakeAmount;
        }
        else{
            amountToEmit = amount;
        }

        emit Stake(
            msg.sender,
            vault,
            amountToEmit,
            rewardPerSecond,
            stakeData.stakeUnlockTime,
            rewardToTransfer
        );

        // check for the bonus pool threshold
        _checkPoolThreshold();

        // transfer reward if there is any
        if (rewardToTransfer > 0) {
            emit RewardReleased(msg.sender, vault, rewardToTransfer);
            _bonusPoolAmount -= rewardToTransfer;
            _tokenAddress.safeTransfer(msg.sender, rewardToTransfer);
        }

        // transfer the token to the smart contract if amount is not zero
        if (amount > 0) {
            _tokenAddress.safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /**
     * @notice This function is used to unstake the tokens
     * @dev remaining rewards are sent along with the amount
     * @dev only whole stake can be unstaked; cannot unstake a particular amount
     * @dev if the lock period for the vault has not been reached a penalty will be
     * deducted from the stake before releasing it
     * @param vault vault number of the stake which has to be unstaked
     */
    function unStake(uint256 vault) external nonReentrant {
        _checkStakeExist(vault);

        StakeData memory stakeData = _stakeData[msg.sender][vault];
        (uint256 penalty, uint256 reward, ) = _getPenaltyAndRewards(
            stakeData,
            _claimTime[msg.sender][vault],
            true
        );

        uint256 amountToTransfer;
        if (reward > 0) {
            amountToTransfer = stakeData.stakeAmount + reward - penalty;
            _bonusPoolAmount -= reward;
        } else amountToTransfer = stakeData.stakeAmount - penalty;

        _stakeExist[msg.sender][vault] = false;
        _totalStake -= stakeData.stakeAmount;

        emit UnStake(msg.sender, vault, stakeData.stakeAmount, penalty, reward);
        emit RewardReleased(msg.sender, vault, reward);
        delete _stakeData[msg.sender][vault];

        _tokenAddress.safeTransfer(msg.sender, amountToTransfer);
    }

    /**
     * @notice This function is used for claiming the reward for a particular vault's stake
     * @dev reward is computed from the last claim time
     * @param vault vault number of the stake of which reward has to be claimed
     */
    function claimReward(uint256 vault) external nonReentrant {
        _checkStakeExist(vault);

        StakeData memory stakeData = _stakeData[msg.sender][vault];

        uint256 interval = _getInterval(
            stakeData.stakeUnlockTime,
            _claimTime[msg.sender][vault]
        );

        require(interval > 0, "Staking: No rewards");
        uint256 reward = _getTotalReward(stakeData.rewardPerSecond, interval);

        _claimTime[msg.sender][vault] = block.timestamp;
        _totalExpectedBonus -= reward;
        _bonusPoolAmount -= reward;

        emit RewardReleased(msg.sender, vault, reward);
        _tokenAddress.safeTransfer(msg.sender, reward);
    }

    /* User Methods End */

    /* Internal Helper Methods Start */

    /**
     * @notice function for calculating the reward per second based on APY
     * @dev this is an internal function which is used inside the staking function
     * @param rewardRate reward rate based on the locking period
     * @param amount stake amount
     * @return reward reward per second is returned from this function
     */
    function _getReward(uint256 amount, uint256 rewardRate)
        internal
        pure
        returns (uint256 reward)
    {
        reward = (amount * rewardRate) / (10000 * 365 days);
    }

    /* Internal Helper Methods End */

    /* Private Helper Methods Start */

    /**
     * @notice function for calculating the penalty
     * @dev this is a private function which is used inside the unstake function
     * @dev if the unstake time is over, they should be getting the reward
     * only till the original unlock time.
     * @param stakeData entire stake data of a staker for a particular vault
     * @param isUnstake this is to determine if the call is from unstake() or stake() function
     * @return penalty penalty for the unstake
     * @return reward reward for this stake at the time of unstaking
     */
    function _getPenaltyAndRewards(
        StakeData memory stakeData,
        uint256 claimTime,
        bool isUnstake
    )
        private
        returns (
            uint256 penalty,
            uint256 reward,
            bool unlockOver
        )
    {
        uint256 unspentReward;
        uint256 interval;

        if (block.timestamp < stakeData.stakeUnlockTime) {
            interval = block.timestamp - claimTime;
            unspentReward = _getTotalReward(
                stakeData.rewardPerSecond,
                stakeData.stakeUnlockTime - block.timestamp
            );
            if (isUnstake) {
                penalty = ((stakeData.stakeAmount * _penaltyRate) / 10000);
                _collectedPenalties += penalty;
            }
        } else {
            if (stakeData.stakeUnlockTime > claimTime)
                interval = stakeData.stakeUnlockTime - claimTime;
            unlockOver = true;
        }

        reward = _getTotalReward(stakeData.rewardPerSecond, interval);

        _totalExpectedBonus -= (reward + unspentReward);
        return (penalty, reward, unlockOver);
    }

    /**
     * @notice function for checking the bonus pool threshold when a new stake comes
     * @dev this is a private function which check if the
     * threshold has been reached
     * @dev difference of the bonus pool and current total bonus
     * should be less than the threshold
     * @dev an event BonusThresholdReached is emitted which will be captured at the front end
     * to send e-mail notification for the admin to add more tokens to reward pool.
     */
    function _checkPoolThreshold() private {
        uint256 bonusPool = _bonusPoolAmount;
        uint256 expectedBonus = _totalExpectedBonus;
        uint256 threshold = (bonusPool * _bonusPoolThreshold) / 10000;

        if (threshold > (bonusPool - expectedBonus)) {
            emit BonusThresholdReached(bonusPool, expectedBonus);
        }
    }

    /* Private View */

    /**
     * @notice function for checking the vault requirement
     * @dev this is a private function
     * @param vault vault number for the stake
     */
    function _checkVault(uint256 vault) private view {
        require(_rewardRate[vault] > 0, "Staking: Invalid vault");
    }

    /**
     * @notice function for checking if stake exists
     * @dev this is a private function
     * @param vault vault number for the stake
     */
    function _checkStakeExist(uint256 vault) private view {
        require(
            _stakeExist[msg.sender][vault],
            "Staking: Stake does not exist for this vault"
        );
    }

    /**
     * @notice function for checking amount requirements before the payment
     * @dev this is a private function
     * @param amount amount
     */
    function _paymentPrecheck(uint256 amount) private view {
        require(
            amount > 0,
            "Staking: Amount should be greater than zero"
        );

        require(
            _tokenAddress.balanceOf(msg.sender) >= amount,
            "Staking: Insufficient balance"
        );
    }

    /**
     * @notice function for calculating the interval for the rewards
     * @dev this is a private function
     * @param unlockTime unlock time of the stake
     * @param lastClaimTime last claim time of the stake's reward
     * @return interval difference between previous claim and current claim time
     */
    function _getInterval(uint256 unlockTime, uint256 lastClaimTime)
        private
        view
        returns (uint256 interval)
    {
        if (unlockTime > block.timestamp)
            interval = block.timestamp - lastClaimTime;
        else if (unlockTime > lastClaimTime)
            interval = unlockTime - lastClaimTime;
    }

    /* Private View Ends

    /* Private Pure */

    /**
     * @notice function for calculating the total reward for the given time
     * @dev this is a private function
     * @param rewardPerSecond reward per second
     * @param interval duration for the reward
     * @return totalReward_ reward per second is returned from this function
     */
    function _getTotalReward(uint256 rewardPerSecond, uint256 interval)
        private
        pure
        returns (uint256 totalReward_)
    {
        totalReward_ = rewardPerSecond * interval;
    }

    /* Private Pure Ends */

    /* Private Helper Methods End */
}