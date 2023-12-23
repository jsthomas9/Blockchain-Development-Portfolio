//To execute test case checking revocability, uncomment setCurrentTime() method in vesting smart contract

require("@openzeppelin/hardhat-upgrades");
const { upgrades, ethers, network } = require("hardhat");
const { expect } = require("chai");
const { constants, balance, time } = require("@openzeppelin/test-helpers");

describe("Vesting", function () {
  let Token;
  let testToken;
  let TokenVesting;
  let Proxy;
  let owner;
  let addr1;
  let addr2;
  let addrs;

 
  beforeEach(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    Token = await ethers.getContractFactory("Token");
    testToken = await Token.deploy();
    TokenVesting = await ethers.getContractFactory("Vesting");
    await testToken.waitForDeployment();

    Proxy = await upgrades.deployProxy(
      TokenVesting,
      [testToken.address],
      {
        initializer: "initialize",
      }
    );
    await Proxy.waitForDeployment();
  });

  describe("Initialize", () => {
    it("Should revert if initializer is called twice", async () => {
      await expect(
        Proxy.initialize(testToken.address)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Investing", () =>{
    it("Should revert if user is not whitelisted", async function () {
      expect((await Proxy.getToken()).toString()).to.equal(
        testToken.address
      );
      // send tokens to vesting contract
      await expect(testToken.transfer(Proxy.address, 1000))
        .to.emit(testToken, "Transfer")
        .withArgs(owner.address, Proxy.address, 1000);
      const vestingContractBalance = await testToken.balanceOf(
        Proxy.address
      );
      expect(vestingContractBalance).to.equal(1000);
      //expect(await Proxy.getWithdrawableAmount()).to.equal(1000);

      const baseTime = Date.now();
      const beneficiary = addr1;
      const name = "first";
      const releaseTimes = [baseTime+50,baseTime+100];
      const releaseAmounts = [50,50];
      const totalPoolTokenAmount = 1000;

      // create new vesting schedule
      await Proxy.addVestingPool(
        name,
        releaseTimes,
        releaseAmounts,
        totalPoolTokenAmount
      );
      expect(await Proxy.getPoolCount()).to.be.equal(1);

      await expect(
        Proxy.connect(beneficiary).addToBeneficiariesList(0,beneficiary.address,100)
      ).to.be.revertedWith(
        "Vesting: not whitelisted"
      );
    });
    it("Should allow whitelisted user to invest", async function () {
      expect((await Proxy.getToken()).toString()).to.equal(
        testToken.address
      );
      // send tokens to vesting contract
      await expect(testToken.transfer(Proxy.address, 1000))
        .to.emit(testToken, "Transfer")
        .withArgs(owner.address, Proxy.address, 1000);
      const vestingContractBalance = await testToken.balanceOf(
        Proxy.address
      );
      expect(vestingContractBalance).to.equal(1000);
      //expect(await Proxy.getWithdrawableAmount()).to.equal(1000);

      const baseTime = Date.now();
      const beneficiary = addr1;
      const name = "first";
      const releaseTimes = [baseTime+50,baseTime+100];
      const releaseAmounts = [50,50];
      const totalPoolTokenAmount = 1000;

      // create new vesting schedule
      await Proxy.addVestingPool(
        name,
        releaseTimes,
        releaseAmounts,
        totalPoolTokenAmount
      );
      expect(await Proxy.getPoolCount()).to.be.equal(1);
      await Proxy.addToWhitelist(0,beneficiary.address);
      await (
        Proxy.connect(beneficiary).addToBeneficiariesList(0,beneficiary.address,100)
      );
    });
  });

  describe("Vesting", function () {
    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await testToken.balanceOf(owner.address);
      expect(await testToken.totalSupply()).to.equal(ownerBalance);
    });

    it("Should vest tokens", async function () {
      
      expect((await Proxy.getToken()).toString()).to.equal(
        testToken.address
      );
      // send tokens to vesting contract
      await expect(testToken.transfer(Proxy.address, 1000))
        .to.emit(testToken, "Transfer")
        .withArgs(owner.address, Proxy.address, 1000);
      const vestingContractBalance = await testToken.balanceOf(
        Proxy.address
      );
      expect(vestingContractBalance).to.equal(1000);
      //expect(await Proxy.getWithdrawableAmount()).to.equal(1000);

      const baseTimeNow = Date.now();
      const baseTime = baseTimeNow*1000;
      const beneficiary = addr1;
      const name = "first";
      const releaseTimes = [baseTime+50000,baseTime+100000];
      const releaseAmounts = [50,50];
      const totalPoolTokenAmount = 1000;

      // create new vesting schedule
      await Proxy.addVestingPool(
        name,
        releaseTimes,
        releaseAmounts,
        totalPoolTokenAmount
      );
      expect(await Proxy.getPoolCount()).to.be.equal(1);
      await Proxy.addToWhitelist(0,beneficiary.address);
      await (
        Proxy.connect(beneficiary).addToBeneficiariesList(0,beneficiary.address,100)
      );
      await time.increaseTo(baseTime+50000);
      await (
        Proxy.connect(beneficiary).claimTokens(0)
      )
        .to.emit(testToken, "Transfer")
        .withArgs(beneficiary.address,0, 50);

        await time.increaseTo(baseTime+100000);
        await (
          Proxy.connect(beneficiary).claimTokens(0)
        )
          .to.emit(testToken, "Transfer")
          .withArgs(beneficiary.address,0, 50);        
    });

    it("Should check input parameters for addVestingPool method", async function () {
      
      await testToken.transfer(Proxy.address, 1000);
      const time = Date.now();
      await expect(
        Proxy.addVestingPool(
          "name",
          [time+60,time+120],
          [0,0],
          1000
        )
      ).to.be.revertedWith("Vesting: release percentages should add upto 100");
    });
  });
});