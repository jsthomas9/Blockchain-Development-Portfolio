require("@openzeppelin/hardhat-upgrades");
const { upgrades, ethers, network } = require("hardhat");
const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { constants, balance } = require("@openzeppelin/test-helpers");

describe("Staking", () => {
  let admin, add1, add2, Staking, staking, Token, token;
  let bonusThreshold = 5000;

  // convert to ether
  function getValue(amount) {
    let _amount = BigNumber.from(amount).mul(
      BigNumber.from(10).pow(BigNumber.from(18))
    );
    return _amount;
  }

  // converting to second
  function getTimeInSec(days) {
    let _timeInSec = days * 24 * 60 * 60;
    return _timeInSec;
  }

  // compute reward perSecond
  function getRewardPerSec(amount, rate) {
    let _time = getTimeInSec(365);
    let _reward = BigNumber.from(amount)
      .mul(BigNumber.from(rate))
      .div(BigNumber.from(10000).mul(BigNumber.from(_time)));
    return _reward;
  }

  // compute total reward
  function getTotalReward(rewardPerSecond, interval) {
    let _totalReward = BigNumber.from(rewardPerSecond).mul(
      BigNumber.from(interval)
    );
    return _totalReward;
  }

  // compute pool threshold
  function getPoolThreshold(bonusPool, expectedBonus) {
    let threshold = BigNumber.from(bonusPool)
      .mul(BigNumber.from(bonusThreshold))
      .div(BigNumber.from(10000));
    let difference = BigNumber.from(bonusPool).sub(
      BigNumber.from(expectedBonus)
    );

    if (BigNumber.from(threshold).gt(BigNumber.from(difference))) return true;
    else return false;
  }

  // compute penalty
  function getPenalty(amount, penaltyRate) {
    let _penalty = BigNumber.from(amount)
      .mul(BigNumber.from(penaltyRate))
      .div(BigNumber.from(10000));
    return _penalty;
  }

  beforeEach(async () => {
    [admin, add1, add2, _] = await ethers.getSigners();

    Token = await ethers.getContractFactory("Token");
    token = await Token.deploy();
    Staking = await ethers.getContractFactory("Staking");
    // 2% fine percentage
    staking = await upgrades.deployProxy(
      Staking,
      [token.address, admin.address, 200],
      {
        initializer: "initialize",
      }
    );
    staking.deployed();
  });

  describe("Initialize", () => {
    it("Should revert if initializer is called twice", async () => {
      await expect(
        staking.initialize(token.address, admin.address, 200)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("should set all the state variable parameters", async () => {
      expect(await staking.tokenAddress()).to.equal(token.address);
      expect(await staking.owner()).to.equal(admin.address);
      expect(await staking.penaltyRate()).to.equal(200);
    });
  });

  describe("Add Vault", () => {
    it("Should revert if the caller is not the owner", async () => {
      let lockPeriod = getTimeInSec(2);

      await expect(
        staking.connect(add1).addVault(0, lockPeriod, 200)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the rate is invalid ( not between 0-100)", async () => {
      let lockPeriod = getTimeInSec(2);

      await expect(
        staking.connect(admin).addVault(0, lockPeriod, 0)
      ).to.be.revertedWith("Staking: In-valid fine percentage");
    });

    it("Should revert if the max vault has been reached (4 vaults)", async () => {
      let lockPeriod1 = getTimeInSec(2);
      let lockPeriod2 = getTimeInSec(3);
      let lockPeriod3 = getTimeInSec(4);
      let lockPeriod4 = getTimeInSec(5);
      let lockPeriod5 = getTimeInSec(6);

      await staking.connect(admin).addVault(0, lockPeriod1, 100);
      await staking.connect(admin).addVault(1, lockPeriod2, 200);
      await staking.connect(admin).addVault(2, lockPeriod3, 100);
      await staking.connect(admin).addVault(3, lockPeriod4, 200);

      await expect(
        staking.connect(admin).addVault(4, lockPeriod5, 1000)
      ).to.be.revertedWith("Staking: Invalid vault");
    });

    it("Should revert if the vault exist", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await expect(
        staking.connect(admin).addVault(0, lockPeriod, 100)
      ).to.be.revertedWith("Staking: Vault exist");
    });

    it("Should add the vault properly and emit the event", async () => {
      let lockPeriod = getTimeInSec(2);

      await expect(staking.connect(admin).addVault(0, lockPeriod, 200))
        .to.emit(staking, "VaultAdded")
        .withArgs(0, lockPeriod, 200);

      let vault = await staking.getVault(0);
      expect(vault.lockingPeriod).to.equal(lockPeriod);
      expect(vault.rewardRate).to.equal(200);
    });
  });

  describe("Modify Vault", () => {
    it("Should revert if the caller is not the owner", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await expect(
        staking.connect(add1).modifyVault(0, lockPeriod, 300)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the rate is invalid ( not between 0-100)", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await expect(
        staking.connect(admin).modifyVault(0, lockPeriod, 0)
      ).to.be.revertedWith("Staking: In-valid fine percentage");
    });

    it("Should revert if the vault does not exist", async () => {
      let lockPeriod = getTimeInSec(2);

      await expect(
        staking.connect(admin).modifyVault(0, lockPeriod, 100)
      ).to.be.revertedWith("Staking: Invalid vault");
    });

    it("Should modify the vault properly and emit the event", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);

      await expect(staking.connect(admin).modifyVault(0, lockPeriod, 300))
        .to.emit(staking, "VaultModified")
        .withArgs(0, lockPeriod, 300);

      let vault = await staking.getVault(0);
      expect(vault.lockingPeriod).to.equal(lockPeriod);
      expect(vault.rewardRate).to.equal(300);
    });
  });

  describe("Remove Vault", () => {
    it("Should revert if the caller is not the owner", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await expect(
        staking.connect(add1).removeVault(0)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the vault does not exist", async () => {
      let lockPeriod = getTimeInSec(2);

      await expect(
        staking.connect(admin).removeVault(0)
      ).to.be.revertedWith("Staking: Invalid vault");
    });

    it("Should remove the vault properly and emit the event", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await expect(staking.connect(admin).removeVault(0))
        .to.emit(staking, "VaultRemoved")
        .withArgs(0, lockPeriod);

      let vault = await staking.getVault(0);
      expect(vault.lockingPeriod).to.equal(0);
      expect(vault.rewardRate).to.equal(0);
    });
  });

  describe("Change Penalty Rate", () => {
    it("Should revert if the caller is not the owner", async () => {
      await expect(
        staking.connect(add1).changePenaltyRate(200)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the rate is invalid ( not between 0-100)", async () => {
      await expect(
        staking.connect(admin).changePenaltyRate(10001)
      ).to.be.revertedWith("Staking: In-valid fine percentage");
    });

    it("Should revert if the penalty rate is same", async () => {
      staking.connect(admin).changePenaltyRate(100);
      await expect(
        staking.connect(admin).changePenaltyRate(100)
      ).to.be.revertedWith("Staking: Penalty rate same");
    });

    it("Should modify the penalty rate properly and emit the event", async () => {
      await expect(staking.connect(admin).changePenaltyRate(100))
        .to.emit(staking, "PenaltyRateChanged")
        .withArgs(100);

      expect(await staking.penaltyRate()).to.equal(100);
    });
  });

  describe("Withdraw Penalties", () => {
    it("Should revert if the caller is not the owner", async () => {
      await expect(
        staking.connect(add1).withdrawPenalties()
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the penalty is zero", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      await network.provider.send("evm_increaseTime", [lockPeriod]);
      await network.provider.send("evm_mine");

      await staking.connect(add1).unStake(0);

      await expect(staking.withdrawPenalties()).to.be.revertedWith(
        "Staking: No penalty has been collected"
      );
    });

    it("Should trasnfer penalty to the owner, set the values and emit events properly", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);
      let unlockPeriod = getTimeInSec(1);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute rewards and other datas
      let penalty = getPenalty(amount, 500);
      let ownerBalance = BigNumber.from(amount).add(BigNumber.from(penalty));

      // mine the new block with future timestamp
      await network.provider.send("evm_increaseTime", [unlockPeriod]);
      await network.provider.send("evm_mine");

      await staking.connect(add1).unStake(0);

      expect(await staking.collectedPenalties()).to.equal(penalty);

      // collect the penalty
      await expect(staking.withdrawPenalties())
        .to.emit(staking, "PenaltyWithdraw")
        .withArgs(admin.address, penalty);

      expect(await token.balanceOf(admin.address)).to.equal(ownerBalance);
      expect(await staking.collectedPenalties()).to.equal(0);
    });
  });

  describe("Withdraw Balance", () => {
    it("Should revert if the caller is not the owner", async () => {
      await expect(
        staking.connect(add1).withdrawBalance()
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the balance is zero", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(90);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 10000);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);
      await staking.withdrawBalance();

      await expect(staking.withdrawBalance()).to.be.revertedWith(
        "Staking: Zero balance"
      );
    });

    it("Should trasnfer balance to the owner after deducting total stake and rewards and emit events properly", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(90);
      let contractBalance = getValue(100);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 10000);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      let totalExpectedBonus = await staking.totalExpectedBonus();
      let balance = BigNumber.from(contractBalance)
        .sub(BigNumber.from(amount))
        .sub(BigNumber.from(totalExpectedBonus));

      // collect the balance
      await expect(staking.withdrawBalance())
        .to.emit(staking, "BalanceWithdraw")
        .withArgs(admin.address, balance);

      // modified contract balance
      contractBalance = BigNumber.from(amount).add(
        BigNumber.from(totalExpectedBonus)
      );

      expect(await token.balanceOf(admin.address)).to.equal(balance);
      expect(await token.balanceOf(staking.address)).to.equal(
        contractBalance
      );
    });
  });

  describe("Add Potential Owner", () => {
    it("Should revert if the caller is not the owner", async () => {
      await expect(
        staking.connect(add1).addPotentialOwner(add1.address)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the potential owner address is a zero address", async () => {
      await expect(
        staking.connect(admin).addPotentialOwner(constants.ZERO_ADDRESS)
      ).to.be.revertedWith("Staking: Zero address");
    });

    it("Should revert if the potential owner address is of the owner itself", async () => {
      await expect(
        staking.connect(admin).addPotentialOwner(admin.address)
      ).to.be.revertedWith(
        "Staking: Potential Owner should not be owner"
      );
    });

    it("Should revert if the potential owner address is same", async () => {
      await staking.connect(admin).addPotentialOwner(add1.address);
      await expect(
        staking.connect(admin).addPotentialOwner(add1.address)
      ).to.be.revertedWith("Staking: Already a potential owner");
    });

    it("Should change the potential owner properly and emit the event", async () => {
      await expect(staking.connect(admin).addPotentialOwner(add1.address))
        .to.emit(staking, "NominateOwner")
        .withArgs(add1.address);

      expect(await staking.potentialOwner()).to.equal(add1.address);
    });
  });

  describe("Change Bonus Pool Threshold", () => {
    it("Should revert if the caller is not the owner", async () => {
      await expect(
        staking.connect(add1).changeBonusPoolThreshold(200)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the rate is invalid ( not between 0-100)", async () => {
      await expect(
        staking.connect(admin).changeBonusPoolThreshold(10001)
      ).to.be.revertedWith("Staking: In-valid fine percentage");
    });

    it("Should revert if the bonus pool threshold is same", async () => {
      staking.connect(admin).changeBonusPoolThreshold(100);
      await expect(
        staking.connect(admin).changeBonusPoolThreshold(100)
      ).to.be.revertedWith("Staking: Bonus threshold same");
    });

    it("Should modify the bonus pool threshold properly and emit the event", async () => {
      await expect(staking.connect(admin).changeBonusPoolThreshold(100))
        .to.emit(staking, "BonusThresholdChanged")
        .withArgs(100);

      expect(await staking.bonusPoolThreshold()).to.equal(100);
    });
  });

  describe("Add Bonus Pool Amount", () => {
    it("Should revert if the caller is not the owner", async () => {
      let amount = getValue(100);

      await expect(
        staking.connect(add1).addBonusPoolAmount(amount)
      ).to.be.revertedWith("Staking: Only owner can call this function");
    });

    it("Should revert if the amount is not greater than zero", async () => {
      await expect(
        staking.connect(admin).addBonusPoolAmount(0)
      ).to.be.revertedWith("Staking: Amount should be greater than zero");
    });

    it("Should revert if the owner does not have enough balance", async () => {
      let amount = getValue(100);

      await token.connect(admin).approve(staking.address, amount);
      await token.connect(admin).transfer(add1.address, amount);
      await expect(
        staking.connect(admin).addBonusPoolAmount(amount)
      ).to.be.revertedWith("Staking: Insufficient balance");
    });

    it("Should add the bonus pool amount properly and emit the events", async () => {
      let amount = getValue(10);

      await token.connect(admin).approve(staking.address, amount);
      await expect(staking.connect(admin).addBonusPoolAmount(amount))
        .to.emit(staking, "BonusPoolAmountAdded")
        .withArgs(amount, amount);

      expect(await staking.connect(admin).bonusPoolAmount()).to.equal(
        amount
      );
      expect(await token.balanceOf(staking.address)).to.equal(amount);
    });
  });

  describe("Accept Ownership", () => {
    it("Should revert if the caller is not the potential owner", async () => {
      await expect(
        staking.connect(add1).acceptOwnership()
      ).to.be.revertedWith(
        "Staking: Only the potential owner can accept ownership"
      );
    });

    it("Should set the new owner and emit the event properly", async () => {
      await staking.connect(admin).addPotentialOwner(add1.address);
      await expect(staking.connect(add1).acceptOwnership())
        .to.emit(staking, "OwnerChanged")
        .withArgs(add1.address);

      expect(await staking.potentialOwner()).to.equal(
        constants.ZERO_ADDRESS
      );
      expect(await staking.owner()).to.equal(add1.address);
    });
  });

  describe("Stake Tokens", () => {
    it("Should revert if the amount is not greater than zero", async () => {
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await expect(staking.connect(admin).stake(0, 0)).to.be.revertedWith(
        "Staking: Amount should be greater than zero"
      );
    });

    it("Should revert if the staker does not have enough balance", async () => {
      let amount = getValue(10);
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);
      await token.connect(add1).transfer(add2.address, amount);

      await expect(
        staking.connect(add1).stake(amount, 0)
      ).to.be.revertedWith("Staking: Insufficient balance");
    });

    it("Should revert if the vault does not exist", async () => {
      let amount = getValue(10);
      let lockPeriod = getTimeInSec(2);

      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      await expect(
        staking.connect(add1).stake(amount, 0)
      ).to.be.revertedWith("Staking: Invalid vault");
    });

    it("Should revert if there is not enough balance in the bonus pool for the total reward for the stake", async () => {
      let amount = getValue(10);
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      await expect(
        staking.connect(add1).stake(amount, 0)
      ).to.be.revertedWith("Staking: Insufficient balance in bonus pool");
    });

    it("Should stake for the first time for a particular vault, set the values and emit events properly", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);
      // admin stake 10 tokens to test the total stake and total rewards
      await token.connect(admin).approve(staking.address, amount);
      await staking.connect(admin).stake(amount, 0);

      // compute stake and other datas
      let rewardPerSecond = getRewardPerSec(amount, 200);
      let lastClaimTime = (await ethers.provider._getBlock()).timestamp - 2;
      let stakeUnlockTime = BigNumber.from(lastClaimTime).add(
        BigNumber.from(lockPeriod)
      );
      let totalStake = BigNumber.from(amount).mul(BigNumber.from(2));
      let totalReward = getTotalReward(rewardPerSecond, lockPeriod);
      let totalExpectedBonus = BigNumber.from(totalReward).mul(
        BigNumber.from(2)
      );

      // get stake and other datas from smart contract
      let stakeData = await staking.getStake(add1.address, 0);
      expect(stakeData[0].stakeAmount).to.equal(amount);
      expect(stakeData[0].stakingTime).to.equal(lastClaimTime);
      expect(stakeData[0].stakeUnlockTime).to.equal(stakeUnlockTime);
      expect(stakeData[0].rewardPerSecond).to.equal(rewardPerSecond);
      expect(await staking.totalStake()).to.equal(totalStake);
      expect(await staking.totalExpectedBonus()).to.equal(
        totalExpectedBonus
      );

      // check pool threshold
      let thresholdReached = getPoolThreshold(bonusPool, totalExpectedBonus);
      expect(thresholdReached).to.equal(false);
    });

    it("Should emit the event threshold reached properly once reaching the threshold", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(1);
      let lockPeriod = getTimeInSec(200);

      // compute the datas
      let rewardPerSecond = getRewardPerSec(amount, 1500);
      let totalReward = getTotalReward(rewardPerSecond, lockPeriod);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 1500);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(5000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await expect(staking.connect(add1).stake(amount, 0))
        .to.emit(staking, "BonusThresholdReached")
        .withArgs(bonusPool, totalReward);

      // check pool threshold
      let thresholdReached = getPoolThreshold(bonusPool, totalReward);
      expect(thresholdReached).to.equal(true);
    });

    it("Should re-stake for the same vault, set the values, send rewards and emit events properly", async () => {
      let amount = getValue(10);
      let reStake = getValue(20);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);
      let restakeTime = getTimeInSec(1);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 1000);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute reward datas for the first stake
      let rewardPerSecond1 = getRewardPerSec(amount, 1000);
      let totalReward1 = getTotalReward(rewardPerSecond1, lockPeriod);

      await network.provider.send("evm_increaseTime", [restakeTime]);
      await network.provider.send("evm_mine");

      // reward datas at the time of re-stake
      let totalReward2 = getTotalReward(rewardPerSecond1, restakeTime + 3);
      let rewardPerSecond2 = getRewardPerSec(reStake, 1000);

      // reward for the new stake
      let totalReward3 = getTotalReward(rewardPerSecond2, lockPeriod);

      // current total expected bonus
      let unSpentTime = BigNumber.from(lockPeriod).sub(
        BigNumber.from(restakeTime + 3)
      );

      let unSpentReward = getTotalReward(rewardPerSecond1, unSpentTime);
      let totalExpectedBonus = BigNumber.from(totalReward1)
        .sub(BigNumber.from(totalReward2))
        .sub(BigNumber.from(unSpentReward))
        .add(BigNumber.from(totalReward3));

      // transfer some more amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 re-stake 10 tokens
      await expect(staking.connect(add1).stake(amount, 0))
        .to.emit(staking, "RewardReleased")
        .withArgs(add1.address, 0, totalReward2);

      // check the balance of add1
      let balance = await token.balanceOf(add1.address);
      expect(balance).to.equal(totalReward2);

      // check the balance of the pool
      let poolBalance = BigNumber.from(bonusPool).sub(totalReward2);

      // get stake and other datas from smart contract
      let stakeData = await staking.getStake(add1.address, 0);
      expect(stakeData[0].stakeAmount).to.equal(reStake);
      expect(stakeData[0].rewardPerSecond).to.equal(rewardPerSecond2);
      expect(await staking.totalExpectedBonus()).to.equal(
        totalExpectedBonus
      );
      expect(await staking.bonusPoolAmount()).to.equal(poolBalance);
    });

    it("Should repeat the stake for the same vault after un-locking period without adding amount", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(90);
      let lockPeriod = getTimeInSec(2);
      let restakeTime = getTimeInSec(3);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 1000);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute reward datas for the first stake
      let rewardPerSecond = getRewardPerSec(amount, 1000);
      let totalReward = getTotalReward(rewardPerSecond, lockPeriod);

      await network.provider.send("evm_increaseTime", [restakeTime]);
      await network.provider.send("evm_mine");

      let totalExpectedBonus = totalReward;
      let currentTime = (await ethers.provider._getBlock()).timestamp + 1;
      let stakeUnlockTime = BigNumber.from(currentTime).add(
        BigNumber.from(lockPeriod)
      );

      // add1 repeat stake
      await expect(staking.connect(add1).stake(0, 0))
        .to.emit(staking, "RewardReleased")
        .withArgs(add1.address, 0, totalReward);

      // check the balance of add1
      let balance = await token.balanceOf(add1.address);
      expect(balance).to.equal(totalReward);

      // check the balance of the pool
      let poolBalance = BigNumber.from(bonusPool).sub(totalReward);

      // get stake and other datas from smart contract
      let stakeData = await staking.getStake(add1.address, 0);
      expect(stakeData[0].stakeAmount).to.equal(amount);
      expect(stakeData[0].rewardPerSecond).to.equal(rewardPerSecond);
      expect(stakeData[0].stakeUnlockTime).to.equal(stakeUnlockTime);
      expect(await staking.totalExpectedBonus()).to.equal(
        totalExpectedBonus
      );
      expect(await staking.bonusPoolAmount()).to.equal(poolBalance);
    });

    it("Should stake full balance", async () => {
      let amount = 817266761596074000000000n;
      let bonusPool = getValue(10000);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 1000);

      // add bonus pool amount
      await token.connect(admin).mint(admin.address, bonusPool);
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(add1).mint(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      let balance = await token.balanceOf(add1.address);
      await staking.connect(add1).stake(amount, 0);

      // get stake and other datas from smart contract
      let stakeData = await staking.getStake(add1.address, 0);
      expect(stakeData[0].stakeAmount).to.equal(amount);
    });
  });

  describe("Un-Stake Tokens", () => {
    it("Should revert if the stake for the particular vault does not exist", async () => {
      let amount = getValue(10);
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      await expect(staking.connect(add1).unStake(0)).to.be.revertedWith(
        "Staking: Stake does not exist for this vault"
      );
    });

    it("Should un-stake after unlock time without penalty, set the values and emit events properly", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute rewards and other datas
      let rewardPerSecond = getRewardPerSec(amount, 200);
      let totalReward = getTotalReward(rewardPerSecond, lockPeriod);
      let currentBonusPool = BigNumber.from(bonusPool).sub(
        BigNumber.from(totalReward)
      );
      let stakerBalance = BigNumber.from(amount).add(
        BigNumber.from(totalReward)
      );

      await network.provider.send("evm_increaseTime", [lockPeriod]);
      await network.provider.send("evm_mine");

      await expect(staking.connect(add1).unStake(0))
        .to.emit(staking, "UnStake")
        .withArgs(add1.address, 0, amount, 0, totalReward);

      // get stake and other datas from smart contract
      await expect(staking.getStake(add1.address, 0)).to.be.revertedWith(
        "Staking: Stake does not exist for the staker for this vault"
      );
      expect(await staking.totalStake()).to.equal(0);
      expect(await staking.totalExpectedBonus()).to.equal(0);
      expect(await staking.bonusPoolAmount()).to.equal(currentBonusPool);
      expect(await token.balanceOf(add1.address)).to.equal(stakerBalance);
    });

    it("Should un-stake after unlock time with all rewards flushed", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute rewards and other datas
      let rewardPerSecond = getRewardPerSec(amount, 200);
      let totalReward = getTotalReward(rewardPerSecond, lockPeriod);
      let currentBonusPool = BigNumber.from(bonusPool).sub(
        BigNumber.from(totalReward)
      );
      let stakerBalance = BigNumber.from(amount).add(
        BigNumber.from(totalReward)
      );

      await network.provider.send("evm_increaseTime", [lockPeriod]);
      await network.provider.send("evm_mine");

      await expect(staking.connect(add1).claimReward(0))
        .to.emit(staking, "RewardReleased")
        .withArgs(add1.address, 0, totalReward);

      await expect(staking.connect(add1).unStake(0))
        .to.emit(staking, "UnStake")
        .withArgs(add1.address, 0, amount, 0, 0);

      // get stake and other datas from smart contract
      await expect(staking.getStake(add1.address, 0)).to.be.revertedWith(
        "Staking: Stake does not exist for the staker for this vault"
      );
      expect(await staking.totalStake()).to.equal(0);
      expect(await staking.totalExpectedBonus()).to.equal(0);
      expect(await staking.bonusPoolAmount()).to.equal(currentBonusPool);
      expect(await token.balanceOf(add1.address)).to.equal(stakerBalance);
    });

    it("Should un-stake before unlock time with penalty, set the values and emit events properly", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);
      let unlockPeriod = getTimeInSec(1);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute rewards and other datas
      let rewardPerSecond = getRewardPerSec(amount, 200);
      let totalRewardAfterUnstake = getTotalReward(
        rewardPerSecond,
        unlockPeriod + 1
      );
      let currentBonusPool = BigNumber.from(bonusPool).sub(
        BigNumber.from(totalRewardAfterUnstake)
      );
      let penalty = getPenalty(amount, 500);
      let stakerBalance = BigNumber.from(amount)
        .add(BigNumber.from(totalRewardAfterUnstake))
        .sub(BigNumber.from(penalty));

      // mine the new block with future timestamp
      await network.provider.send("evm_increaseTime", [unlockPeriod]);
      await network.provider.send("evm_mine");

      await expect(staking.connect(add1).unStake(0))
        .to.emit(staking, "UnStake")
        .withArgs(add1.address, 0, amount, penalty, totalRewardAfterUnstake);

      // get stake and other datas from smart contract
      await expect(staking.getStake(add1.address, 0)).to.be.revertedWith(
        "Staking: Stake does not exist for the staker for this vault"
      );
      expect(await staking.totalStake()).to.equal(0);
      expect(await staking.totalExpectedBonus()).to.equal(0);
      expect(await staking.bonusPoolAmount()).to.equal(currentBonusPool);
      expect(await token.balanceOf(add1.address)).to.equal(stakerBalance);
      expect(await staking.collectedPenalties()).to.equal(penalty);
    });
  });

  describe("Claim Rewards", () => {
    it("Should revert if the stake for the particular vault does not exist", async () => {
      let amount = getValue(10);
      let lockPeriod = getTimeInSec(2);

      await staking.connect(admin).addVault(0, lockPeriod, 200);
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      await expect(
        staking.connect(add1).claimReward(0)
      ).to.be.revertedWith(
        "Staking: Stake does not exist for this vault"
      );
    });

    it("Should transfer all the rewards after lockPeriod and succeeding claims should revert", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);
      let claimPeriod = getTimeInSec(1);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute rewards and other datas
      let rewardPerSecond = getRewardPerSec(amount, 200);
      let totalRewardAtClaim = getTotalReward(rewardPerSecond, lockPeriod);
      let currentBonusPool = BigNumber.from(bonusPool).sub(
        BigNumber.from(totalRewardAtClaim)
      );

      // mine the new block with future timestamp
      await network.provider.send("evm_increaseTime", [lockPeriod]);
      await network.provider.send("evm_mine");

      await expect(staking.connect(add1).claimReward(0))
        .to.emit(staking, "RewardReleased")
        .withArgs(add1.address, 0, totalRewardAtClaim);

      // get stake and other data from smart contract
      expect(await staking.totalExpectedBonus()).to.equal(0);
      expect(await staking.bonusPoolAmount()).to.equal(currentBonusPool);
      expect(await token.balanceOf(add1.address)).to.equal(totalRewardAtClaim);
      await expect(staking.connect(add1).claimReward(0))
        .to.be.revertedWith("Staking: No rewards");
      let stakeData = await staking.getStake(add1.address, 0);
      expect(stakeData[2]).to.equal(0);  
    });

    it("Should transfer the reward, set the values and emit events properly", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);
      let claimPeriod = getTimeInSec(1);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // compute rewards and other datas
      let rewardPerSecond = getRewardPerSec(amount, 200);
      let totalRewardAtClaim = getTotalReward(rewardPerSecond, claimPeriod + 1);
      let currentBonusPool = BigNumber.from(bonusPool).sub(
        BigNumber.from(totalRewardAtClaim)
      );
      let totalExpectedBonusAfterClaim = getTotalReward(
        rewardPerSecond,
        lockPeriod - claimPeriod - 1
      );

      // mine the new block with future timestamp
      await network.provider.send("evm_increaseTime", [claimPeriod]);
      await network.provider.send("evm_mine");

      await expect(staking.connect(add1).claimReward(0))
        .to.emit(staking, "RewardReleased")
        .withArgs(add1.address, 0, totalRewardAtClaim);

      // get stake and other data from smart contract
      expect(await staking.totalExpectedBonus()).to.equal(
        totalExpectedBonusAfterClaim
      );
      expect(await staking.bonusPoolAmount()).to.equal(currentBonusPool);
      expect(await token.balanceOf(add1.address)).to.equal(totalRewardAtClaim);
    });
  });

  describe("Get Stake", () => {
    it("Should revert if the stake for the particular vault does not exist", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // call getStake
      await expect(staking.getStake(add1.address, 0)).to.be.revertedWith(
        "Staking: Stake does not exist for the staker for this vault"
      );
    });

    it("Should fetch the proper stake details", async () => {
      let amount = getValue(10);
      let bonusPool = getValue(80);
      let lockPeriod = getTimeInSec(2);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod, 200);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, amount);
      await token.connect(add1).approve(staking.address, amount);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);

      // get current time
      let currentTime = (await ethers.provider._getBlock()).timestamp;
      let unlockPeriod = currentTime + lockPeriod;

      // compute reward per second
      let rewardPerSecond = getRewardPerSec(amount, 200);

      // call getStake
      let stakeData = await staking.getStake(add1.address, 0);
      expect(stakeData[0].stakeAmount).to.equal(amount);
      expect(stakeData[0].rewardPerSecond).to.equal(rewardPerSecond);
      expect(stakeData[0].stakeUnlockTime).to.equal(unlockPeriod);
    });
  });

  describe("Get All the Stakes", () => {
    it("Should return all the stake details of a particular staker", async () => {
      let amount = getValue(10);
      let transfer = getValue(40);
      let bonusPool = getValue(60);
      let lockPeriod1 = getTimeInSec(2);
      let lockPeriod2 = getTimeInSec(3);
      let lockPeriod3 = getTimeInSec(4);
      let lockPeriod4 = getTimeInSec(5);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod1, 200);
      await staking.connect(admin).addVault(1, lockPeriod2, 300);
      await staking.connect(admin).addVault(2, lockPeriod3, 400);
      await staking.connect(admin).addVault(3, lockPeriod4, 500);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // add penalty rate
      await staking.changePenaltyRate(500);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, transfer);
      await token.connect(add1).approve(staking.address, transfer);

      // add1 stake 10 tokens toeach vaults
      await staking.connect(add1).stake(amount, 0);
      await staking.connect(add1).stake(amount, 1);
      await staking.connect(add1).stake(amount, 2);
      await staking.connect(add1).stake(amount, 3);

      // compute rewards and other datas
      let rewardPerSecond1 = getRewardPerSec(amount, 200);
      let rewardPerSecond2 = getRewardPerSec(amount, 300);
      let rewardPerSecond3 = getRewardPerSec(amount, 400);
      let rewardPerSecond4 = getRewardPerSec(amount, 500);

      let stakes = await staking.getAllStakes(add1.address);

      expect(stakes[0][0].stakeAmount).to.equal(amount);
      expect(stakes[0][1].stakeAmount).to.equal(amount);
      expect(stakes[0][2].stakeAmount).to.equal(amount);
      expect(stakes[0][3].stakeAmount).to.equal(amount);
      expect(stakes[0][0].rewardPerSecond).to.equal(rewardPerSecond1);
      expect(stakes[0][1].rewardPerSecond).to.equal(rewardPerSecond2);
      expect(stakes[0][2].rewardPerSecond).to.equal(rewardPerSecond3);
      expect(stakes[0][3].rewardPerSecond).to.equal(rewardPerSecond4);
    });
  });

  describe("Get All the Vaults", () => {
    it("Should return all the vault's details", async () => {
      let lockPeriod1 = getTimeInSec(2);
      let lockPeriod2 = getTimeInSec(3);
      let lockPeriod3 = getTimeInSec(4);
      let lockPeriod4 = getTimeInSec(5);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod1, 200);
      await staking.connect(admin).addVault(1, lockPeriod2, 300);
      await staking.connect(admin).addVault(2, lockPeriod3, 400);
      await staking.connect(admin).addVault(3, lockPeriod4, 500);

      let result = await staking.getAllVaults();
      expect(result[0][0]).to.equal(lockPeriod1);
      expect(result[0][1]).to.equal(lockPeriod2);
      expect(result[0][2]).to.equal(lockPeriod3);
      expect(result[0][3]).to.equal(lockPeriod4);
      expect(result[1][0]).to.equal(200);
      expect(result[1][1]).to.equal(300);
      expect(result[1][2]).to.equal(400);
      expect(result[1][3]).to.equal(500);
    });
  });

  describe("Get Total Stake", () => {
    it("Should return the total staked amount for a particular user", async () => {
      let amount = getValue(10);
      let secondAmount = getValue(20);
      let transfer = getValue(30);
      let bonusPool = getValue(70);
      let lockPeriod1 = getTimeInSec(2);
      let lockPeriod2 = getTimeInSec(4);

      // add locking period
      await staking.connect(admin).addVault(0, lockPeriod1, 200);
      await staking.connect(admin).addVault(1, lockPeriod2, 400);

      // add bonus pool amount
      await token.connect(admin).approve(staking.address, bonusPool);
      await staking.connect(admin).addBonusPoolAmount(bonusPool);

      // add bonus pool threshold
      await staking.changeBonusPoolThreshold(1000);

      // transfer some amount to the address 1
      await token.connect(admin).transfer(add1.address, transfer);
      await token.connect(add1).approve(staking.address, transfer);

      // add1 stake 10 tokens
      await staking.connect(add1).stake(amount, 0);
      await staking.connect(add1).stake(secondAmount, 1);

      let totalStake = BigNumber.from(amount).add(BigNumber.from(secondAmount));

      expect(await staking.getTotalStake(add1.address)).to.equal(
        totalStake
      );
    });
  });
});
