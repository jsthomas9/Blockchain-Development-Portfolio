require("@openzeppelin/hardhat-upgrades");
const { upgrades, ethers, network } = require("hardhat");
const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { constants, balance, time, BN } = require("@openzeppelin/test-helpers");
const { MerkleTree } = require('merkletreejs');
const ether = require("@openzeppelin/test-helpers/src/ether");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const { keccak256 } = ethers.utils

describe("Kyoto Launchpad", () =>{
    let admin, projectOwner, add1, add2, LaunchpadV1, launchpad, Token, token, paymentToken, payToken, whitelisted, notWhitelisted, merkleProof, merkleRoot, tree, invalidMerkleProof;

    // convert to ether
    function getValue(amount) {
        let _amount = BigNumber.from(amount).mul(
        BigNumber.from(10).pow(BigNumber.from(18))
        );
        return _amount;
    }
    beforeEach(async () => {
        [admin, projectOwner, add1, add2, _] = await ethers.getSigners();
    
        Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        paymentToken = await ethers.getContractFactory("Token");
        payToken = await paymentToken.deploy();
        LaunchpadV1 = await ethers.getContractFactory("Launchpad");
        launchpad = await upgrades.deployProxy(
          LaunchpadV1,
          {
            initializer: "initialize",
          }
        );
        launchpad.deployed();
    });

    describe("Initialize", () => {
        it("Should revert if initializer is called twice", async () => {
          await expect(
            launchpad.initialize()
          ).to.be.revertedWith("Initializable: contract is already initialized");
        });
    
        it("Should set deployer as owner", async () => {
          expect(await launchpad.owner()).to.equal(admin.address);
    });
  });
    describe("Ownership", () => {
        it("Should add a potential owner", async () => {
            expect(await launchpad.potentialOwner()).to.equal(ZERO_ADDRESS)
            await expect(launchpad.connect(admin).addPotentialOwner(add2.address)).to.emit(launchpad,"NominateOwner").withArgs(add2.address);
            expect(await launchpad.potentialOwner()).to.equal(add2.address);
        });
        describe("Should revert if", () => {
            it("Caller is not the owner", async () => {
                await expect(launchpad.connect(add1).addPotentialOwner(add2.address)).to.be.revertedWith("Launchpad: Only owner allowed");
            });
            it("Potential owner address is zero", async () => {
                await expect(launchpad.connect(admin).addPotentialOwner(ZERO_ADDRESS)).to.be.revertedWith("Launchpad: potential owner zero");
            });
            it("Potential owner is same as owner", async () => {
                await expect(launchpad.connect(admin).addPotentialOwner(admin.address)).to.be.revertedWith("Launchpad: potential owner same as owner");
            });
        });
        it("Should accept ownership", async () => {
            await(launchpad.connect(admin).addPotentialOwner(add2.address));
            await expect(launchpad.connect(add2).acceptOwnership()).to.emit(launchpad,"OwnerChange").withArgs(add2.address);
            expect(await launchpad.owner()).to.equal(add2.address);
        });
        describe("Should revert acceptance if", () => {
            it("Caller is not the potential owner", async () => {
                await expect(launchpad.connect(add2).acceptOwnership()).to.be.revertedWith("Launchpad: only potential owner");
            });
        });
    });
    describe("Admin privileges", () => {
        it("Should add a new admin", async () => {
            await expect(launchpad.connect(admin).grantRole(add2.address)).to.emit(launchpad,"AddAdmin").withArgs(add2.address);
        });
        it("Should revoke admin rights", async () => {
            await(launchpad.connect(admin).addPaymentToken(add2.address));
            await expect(launchpad.connect(admin).revokeRole(add2.address)).to.emit(launchpad,"RevokeAdmin").withArgs(add2.address);
        });
        it("Should revert granting if caller is not the owner", async () => {
            await expect(launchpad.connect(add1).grantRole(add2.address)).to.be.revertedWith("Launchpad: Only owner allowed");
        });
        it("Should revert revoking if caller is not the owner", async () => {
            await expect(launchpad.connect(add1).revokeRole(add2.address)).to.be.revertedWith("Launchpad: Only owner allowed");
        });
    });

    describe("Fee Percentage", () =>{
        it("Should set fee percentage", async () => {
            const fee = BigNumber.from(1000);
            await expect(launchpad.connect(admin).setFee(fee)).to.emit(launchpad,"SetFeePercentage").withArgs(fee);
        })
        describe("Should Revert", async () => {
            it("Should revert if caller is not the owner", async () => {
                const fee = BigNumber.from(1000);
                await expect(launchpad.connect(add1).setFee(fee)).to.be.revertedWith("Launchpad: not authorized");
            });
            it("Should revert if fee is more than 100%", async () => {
                const fee = BigNumber.from(11000);
                await expect(launchpad.connect(admin).setFee(fee)).to.be.revertedWith("Launchpad: fee Percentage should be less than 10000");
            });
        });
    });

    describe("Payment token", () => {
        it("Should add payment token and revert if it's already added", async () => {
            await expect(launchpad.connect(admin).addPaymentToken(payToken.address)).to.emit(launchpad,"AddPaymentToken").withArgs(payToken.address);
            expect(await launchpad.isPaymentTokenSupported(payToken.address)).to.equal(true);
            await expect(launchpad.connect(admin).addPaymentToken(payToken.address)).to.be.revertedWith("Launchpad: token already added");
        });
        it("Should remove payment token and revert if it's not added", async () => {
            await(launchpad.connect(admin).addPaymentToken(payToken.address));
            await expect(launchpad.connect(admin).removePaymentToken(payToken.address)).to.emit(launchpad,"RemovePaymentToken").withArgs(payToken.address);
            expect(await launchpad.isPaymentTokenSupported(payToken.address)).to.equal(false);
            await expect(launchpad.connect(admin).removePaymentToken(payToken.address)).to.be.revertedWith("Launchpad: token not added");
        });
        it("Should revert if caller is not an admin", async () => {
            await expect(launchpad.connect(add1).addPaymentToken(payToken.address)).to.be.revertedWith("Launchpad: not authorized");
        });
    });

    describe("Add fair Launch", () => {
        it("Add Project with native currency", async () => {
            const paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            const projectID = "first";
            const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
            const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            const winnersOutTime = 0
            const projectOpenTime = currentTime+100
            const projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);
        });
        it("Add Project with ERC 20 token for payment", async () => {
            const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            const projectID = "first";
            const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
            const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            const winnersOutTime = 0
            const projectOpenTime = currentTime+100
            const projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);
        });
        describe("Should revert if", () => {
            it("Caller is not an admin", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(admin).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(projectOwner).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: not authorized");
            });
            it("Project ID exists", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime);
                    await expect(launchpad.connect(admin).addPublicLaunch(
                        projectID,
                        projectOwner.address,
                        paymentToken,
                        targetAmount,
                        minInvestmentAmount,
                        token.address,
                        tokenPrice,
                        winnersOutTime,
                        projectOpenTime,
                        projectCloseTime
                    )).to.be.revertedWith("Launchpad: Project id already exist");           
            });
            it("Project Owner address is zero", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(admin).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    "0x0000000000000000000000000000000000000000",
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: Project owner zero");
            }); 
            it("Payment token is not added", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: payment token not supported");
            });
            it("Target amount is zero", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = 0
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = BigNumber.from(1000).mul(BigNumber.from(10).pow(18))
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(admin).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: target amount zero");
            });
            it("Token price is zero", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = 0
                const tokensForDistribution = BigNumber.from(1000).mul(BigNumber.from(10).pow(18))
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(admin).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: token price zero");
            });
            it("Presale time is not zero", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = BigNumber.from(1000).mul(BigNumber.from(10).pow(18))
                const currentTime = Date.now()
                const winnersOutTime = currentTime
                const projectOpenTime = currentTime+100
                const projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(admin).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: presale time not zero");
            });
            it("Timestamps are invalid", async () => {
                const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                const projectID = "first";
                const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                const tokensForDistribution = BigNumber.from(1000).mul(BigNumber.from(10).pow(18))
                const currentTime = Date.now()
                const winnersOutTime = 0
                const projectOpenTime = currentTime-100
                const projectCloseTime = currentTime-200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address, mintValue)
                await token.connect(admin).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: Project invalid timestamps");
            });
        });
        it("Add Project without project token", async () => {
            const paymentToken = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            const projectID = "first";
            const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
            const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            const winnersOutTime = 0
            const projectOpenTime = currentTime+100
            const projectCloseTime = projectOpenTime+200

            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                "0x0000000000000000000000000000000000000000",
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            "0x0000000000000000000000000000000000000000",
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);
        });
    });
    describe("Edit fair Launch", () => {
        it("Change timestamps of an added launch", async () => {
            const paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            const projectID = "first";
            const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
            const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            const winnersOutTime = 0
            const projectOpenTime = currentTime+100
            const projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);
            const newOpenTime = projectOpenTime+100
            const newCloseTime = projectCloseTime+100
            await expect(launchpad.connect(admin).editPublicProject(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                newOpenTime,
                newCloseTime
            )).to.emit(launchpad,"ProjectEdit").withArgs(projectID,
                                                            token.address,
                                                            newOpenTime,
                                                            newCloseTime);                                                
        });
        it("Change project token address from zero to valid address", async () => {
            const paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            const projectID = "first";
            const targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            const minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
            const tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            const tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            const winnersOutTime = 0
            const projectOpenTime = currentTime+100
            const projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                "0x0000000000000000000000000000000000000000",
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            "0x0000000000000000000000000000000000000000",
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);

            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await expect(launchpad.connect(admin).editPublicProject(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectEdit").withArgs(projectID,
                                                            token.address,
                                                            projectOpenTime,
                                                            projectCloseTime);                                                
        });
        describe("Should revert if", () => {
            let projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, tokensForDistribution, winnersOutTime, projectOpenTime, projectCloseTime
            beforeEach(async () => {
                paymentToken = "0x0000000000000000000000000000000000000000";
                await launchpad.connect(admin).addPaymentToken(paymentToken);
                projectID = "first";
                targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
                minInvestmentAmount = BigNumber.from(10).mul(BigNumber.from(10).pow(18))
                tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
                tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
                const currentTime = Date.now()
                winnersOutTime = 0
                projectOpenTime = currentTime+100
                projectCloseTime = projectOpenTime+200
                const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
                await token.connect(projectOwner).mint(projectOwner.address,mintValue)
                expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
                await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            });
            it("Caller is not an admin", async () => {
                await expect(launchpad.connect(add1).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: not authorized")
            });
            it("Project does not exist", async () => {
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: Project does not exist")
            });
            it("Project owner zero", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    "0x0000000000000000000000000000000000000000",
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: Project owner zero")                                                
            });
            it("Payment token is not supported", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee",
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: payment token not supported") 
            });
            it("Target amount is zero", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    0,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: target amount zero") 
            });
            it("Token price is zero", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    0,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: token price zero") 
            });
            it("Pre sale start time is not zero", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime+1,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: presale time not zero") 
            });
            it("Timestamps are invalid", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectCloseTime,
                    projectOpenTime
                )).to.be.revertedWith("Launchpad: invalid timestamps") 
            });
            it("Project token is trying to be added for an already added launch", async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                paymentToken,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await expect(launchpad.connect(admin).editPublicProject(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee",
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.be.revertedWith("Launchpad: Project token already added") 
            });
        });
    });    
    describe("Invest in fair launch", () => {
        let investment, projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, tokensForDistribution, winnersOutTime, projectOpenTime, projectCloseTime
        beforeEach(async () => {
            investment = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            await launchpad.connect(admin).addPaymentToken(payToken.address);
            projectID = "first";
            targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            minInvestmentAmount = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            winnersOutTime = 0
            projectOpenTime = currentTime+100
            projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
        }); 
        it("Invest in a fair launch with BNB", async () => {
            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);
            const previousUserBalance =  await launchpad.provider.getBalance(add1.address)
            const previousLpadBalance =  await launchpad.provider.getBalance(launchpad.address)
            await time.increaseTo(projectOpenTime)
            await expect(launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2") })).to.emit(
                launchpad,"ProjectInvest").withArgs(projectID,add1.address,investment);  
            let projectInvestment = await launchpad.getProjectInvestment(projectID);
            expect(projectInvestment[0]).to.equal(investment)
            expect(projectInvestment[1]).to.equal(0)
            expect(projectInvestment[2]).to.equal(1)
            expect(projectInvestment[3]).to.equal(false)
            let investor = await launchpad.getInvestor(projectID,add1.address)   
            expect(investor[0]).to.equal(investment)
            expect(investor[1]).to.equal(false)
            expect(investor[2]).to.equal(false) 
            expect(await launchpad.provider.getBalance(add1.address)).to.lte(previousUserBalance.sub(BigNumber.from(ethers.utils.parseEther("2"))))
            expect(await launchpad.provider.getBalance(launchpad.address)).to.equal(previousLpadBalance.add(BigNumber.from(ethers.utils.parseEther("2"))))        
        });
        it("Invest in a fair launch with ERC 20 token", async () => {
            await expect(launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                payToken.address,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            payToken.address,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime);
            await time.increaseTo(projectOpenTime)
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await payToken.connect(add1).mint(add1.address,mintValue)
            expect(await payToken.connect(add1).balanceOf(add1.address)).to.be.equal(mintValue)
            const previousUserBalance =  await payToken.connect(add1).balanceOf(add1.address)
            const previousLpadBalance =  await payToken.connect(admin).balanceOf(launchpad.address)
            await payToken.connect(add1).approve(launchpad.address, tokensForDistribution)
            await expect(launchpad.connect(add1).investFairLaunch(projectID,investment)).to.emit(
                launchpad,"ProjectInvest").withArgs(projectID,add1.address,investment); 
            let projectInvestment = await launchpad.getProjectInvestment(projectID);
            expect(projectInvestment[0]).to.equal(investment)
            expect(projectInvestment[1]).to.equal(0)
            expect(projectInvestment[2]).to.equal(1)
            expect(projectInvestment[3]).to.equal(false)
            let investor = await launchpad.getInvestor(projectID,add1.address)   
            expect(investor[0]).to.equal(investment)
            expect(investor[1]).to.equal(false)
            expect(investor[2]).to.equal(false)   
            expect(await payToken.balanceOf(add1.address)).to.equal(previousUserBalance.sub(investment))
            expect(await payToken.balanceOf(launchpad.address)).to.equal(previousLpadBalance.add(investment))                              
        });
        describe("Should revert if", () => {
            beforeEach(async () => {
                await expect(launchpad.connect(admin).addPublicLaunch(
                    projectID,
                    projectOwner.address,
                    payToken.address,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                                projectOwner.address,
                                                                payToken.address,
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
            });
            it("Project does not exist", async () => {
                await time.increaseTo(projectOpenTime)
                await expect(launchpad.connect(add1).investFairLaunch("second",investment)).to.be.revertedWith("Launchpad: Project does not exist")
            });
            it("Investment is zero", async () => {
                await time.increaseTo(projectOpenTime)
                await expect(launchpad.connect(add1).investFairLaunch(projectID,0)).to.be.revertedWith("Launchpad: investment zero")
            });
            it("Project is not open for investment", async () => {
                await expect(launchpad.connect(add1).investFairLaunch(projectID,investment)).to.be.revertedWith("Launchpad: Project is not open")
            });  
            it("Project is closed for investment", async () => {
                await time.increaseTo(projectCloseTime)
                await expect(launchpad.connect(add1).investFairLaunch(projectID,investment)).to.be.revertedWith("Launchpad: Project has closed")
            });
            it("Project is cancelled", async () => {
                await time.increaseTo(projectOpenTime)
                await expect(launchpad.connect(admin).cancelIDO(projectID)).to.emit(launchpad,"ProjectCancel").withArgs(projectID);
                await expect(launchpad.connect(add1).investFairLaunch(projectID,investment)).to.be.revertedWith("Launchpad: Project cancelled")
            });
            it("Amount is less than minimum investment", async () => {
                await time.increaseTo(projectOpenTime)
                const lowInvestment = BigNumber.from(1).mul(BigNumber.from(10).pow(18))
                await expect(launchpad.connect(add1).investFairLaunch(projectID,lowInvestment)).to.be.revertedWith("Launchpad: amount less than minimum investment")
            });  
            it("Amount exceeds target", async () => {
                await time.increaseTo(projectOpenTime)
                const highInvestment = BigNumber.from(10001).mul(BigNumber.from(10).pow(18))
                await expect(launchpad.connect(add1).investFairLaunch(projectID,highInvestment)).to.be.revertedWith("Launchpad: amount exceeds target")
            });   
            it("msg.value not zero", async () => {
                await time.increaseTo(projectOpenTime)
                await expect(launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("1") })).to.be.revertedWith("Launchpad: msg.value not zero")
            }); 
            it("msg.value is not equal to amount", async () => {
                await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).addPublicLaunch(
                    "Second",
                    projectOwner.address,
                    "0x0000000000000000000000000000000000000000",
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    winnersOutTime,
                    projectOpenTime,
                    projectCloseTime
                )).to.emit(launchpad,"ProjectAdd").withArgs("Second",
                                                                projectOwner.address,
                                                                "0x0000000000000000000000000000000000000000",
                                                                targetAmount,
                                                                minInvestmentAmount,
                                                                token.address,
                                                                tokenPrice,
                                                                winnersOutTime,
                                                                projectOpenTime,
                                                                projectCloseTime);
                await time.increaseTo(projectOpenTime)
                await expect(launchpad.connect(add1).investFairLaunch("Second",investment,{ value: ethers.utils.parseEther("1") })).to.be.revertedWith("Launchpad: msg.value not equal to amount")
            });    
        });
    });
    describe("Claim tokens", () => {
        let investment, projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, tokensForDistribution, winnersOutTime, projectOpenTime, projectCloseTime
        beforeEach(async () => {
            investment = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            await launchpad.connect(admin).addPaymentToken(payToken.address);
            projectID = "first";
            targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            minInvestmentAmount = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            winnersOutTime = 0
            projectOpenTime = currentTime+100
            projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )
            await time.increaseTo(projectOpenTime)
        });
        it("Claim tokens with investment in BNB", async () => {
            await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
            let allocatedTokens = await launchpad.estimateProjectTokensById(projectID,investment)
            await time.increaseTo(projectCloseTime)
            expect(await launchpad.connect(add1).claimIDOTokens(projectID)).to.emit(launchpad,"ProjectInvestmentClaim").withArgs(projectID,add1.address,allocatedTokens)
            let projectInvestment = await launchpad.getProjectInvestment(projectID);
            expect(projectInvestment[0]).to.equal(investment)
            expect(projectInvestment[1]).to.equal(allocatedTokens)
            expect(projectInvestment[2]).to.equal(1)
            expect(projectInvestment[3]).to.equal(false)
            let investor = await launchpad.getInvestor(projectID,add1.address)   
            expect(investor[0]).to.equal(investment)
            expect(investor[1]).to.equal(true)
            expect(investor[2]).to.equal(false)   
            expect(await token.balanceOf(add1.address)).to.equal(allocatedTokens)
        });
        it("Claim tokens with investment in ERC 20 token", async () => {
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                "Second",
                projectOwner.address,
                payToken.address,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                Date.now()+100,
                Date.now()+200
            )
            await time.increaseTo(Date.now()+100)
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await payToken.connect(add1).mint(add1.address,mintValue)
            await payToken.connect(add1).approve(launchpad.address, investment)
            await launchpad.connect(add1).investFairLaunch("Second",investment)
            let allocatedTokens = await launchpad.estimateProjectTokensById("Second",investment)
            await time.increaseTo(Date.now()+200)
            expect(await launchpad.connect(add1).claimIDOTokens("Second")).to.emit(launchpad,"ProjectInvestmentClaim").withArgs("Second",add1.address,allocatedTokens)
            let projectInvestment = await launchpad.getProjectInvestment("Second");
            expect(projectInvestment[0]).to.equal(investment)
            expect(projectInvestment[1]).to.equal(allocatedTokens)
            expect(projectInvestment[2]).to.equal(1)
            expect(projectInvestment[3]).to.equal(false)
            let investor = await launchpad.getInvestor("Second",add1.address)   
            expect(investor[0]).to.equal(investment)
            expect(investor[1]).to.equal(true)
            expect(investor[2]).to.equal(false)   
            expect(await token.balanceOf(add1.address)).to.equal(allocatedTokens)
        });
        describe("Should revert if", () => {
            it("Project is cancelled", async () => {
                await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
                await launchpad.connect(admin).cancelIDO(projectID)
                await (expect (launchpad.connect(add1).claimIDOTokens(projectID)).to.be.revertedWith("Launchpad: Project is cancelled"))
            });
            it("Project is not closed", async () => {
                await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
                await (expect (launchpad.connect(add1).claimIDOTokens(projectID)).to.be.revertedWith("Launchpad: Project not closed yet"))
            });
            it("Project token is not added", async () => {
                await launchpad.connect(admin).addPublicLaunch(
                    "NoToken",
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    "0x0000000000000000000000000000000000000000",
                    tokenPrice,
                    winnersOutTime,
                    Date.now()+100,
                    Date.now()+200
                )
                await time.increaseTo(Date.now()+100)
                await launchpad.connect(add1).investFairLaunch("NoToken",investment,{ value: ethers.utils.parseEther("2")})
                await time.increaseTo(Date.now()+200)
                await (expect (launchpad.connect(add1).claimIDOTokens("NoToken")).to.be.revertedWith("Launchpad: Project token not added yet"))
            });
            it("User has already claimed", async () => {
                await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
                await time.increaseTo(projectCloseTime)
                await (launchpad.connect(add1).claimIDOTokens(projectID))
                await (expect (launchpad.connect(add1).claimIDOTokens(projectID)).to.be.revertedWith("Launchpad: already claimed"))
            });
            it("User has not invested", async () => {
                await time.increaseTo(projectCloseTime)
                await (expect (launchpad.connect(add1).claimIDOTokens(projectID)).to.be.revertedWith("Launchpad: no investment found"))
            });
        });
    });
    describe("Collect IDO investments", () => {
        let investment, projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, tokensForDistribution, winnersOutTime, projectOpenTime, projectCloseTime
        beforeEach(async () => {
            investment = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            await launchpad.connect(admin).addPaymentToken(payToken.address);
            projectID = "first";
            targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            minInvestmentAmount = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            winnersOutTime = 0
            projectOpenTime = currentTime+100
            projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )
            await time.increaseTo(projectOpenTime)
        });
        it("Collect investments made in BNB", async () => {
            await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
            const previousContractBalance =  await launchpad.provider.getBalance(launchpad.address)
            const previousOwnerBalance = await launchpad.provider.getBalance(projectOwner.address)
            await time.increaseTo(projectCloseTime)
            expect(await launchpad.connect(admin).collectIDOInvestment(projectID)).emit(launchpad,"ProjectInvestmentCollect").withArgs(projectID)
            expect(await launchpad.provider.getBalance(projectOwner.address)).to.equal(previousOwnerBalance.add(BigNumber.from(ethers.utils.parseEther("2"))))
            expect(await launchpad.provider.getBalance(launchpad.address)).to.equal(previousContractBalance.sub(BigNumber.from(ethers.utils.parseEther("2"))))
            let projectInvestment = await launchpad.getProjectInvestment(projectID);
            expect(projectInvestment[3]).to.be.equal(true)
        });
        it("Collect investments made in ERC20", async () => {
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                "Collect",
                projectOwner.address,
                payToken.address,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                Date.now()+100,
                Date.now()+200
            )
            await time.increaseTo(Date.now()+100)
            await payToken.connect(add1).mint(add1.address,BigNumber.from(1000000).mul(BigNumber.from(10).pow(18)))
            await payToken.connect(add1).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(add1).investFairLaunch("Collect",investment)
            const previousOwnerBalance =  await payToken.connect(projectOwner).balanceOf(projectOwner.address)
            const previousContractBalance =  await payToken.connect(admin).balanceOf(launchpad.address)
            await time.increaseTo(Date.now()+200)
            expect(await launchpad.connect(admin).collectIDOInvestment("Collect")).emit(launchpad,"ProjectInvestmentCollect").withArgs("Collect")
            expect(await payToken.balanceOf(projectOwner.address)).to.equal(previousOwnerBalance.add(investment))
            expect(await payToken.balanceOf(launchpad.address)).to.equal(previousContractBalance.sub(investment))
            let projectInvestment = await launchpad.getProjectInvestment("Collect");
            expect(projectInvestment[3]).to.be.equal(true)
        });
        it("Set Fee and collect platform share", async () => {
            const fee = BigNumber.from(5000);
            await launchpad.connect(admin).setFee(fee)
            await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
            const adminBalance =  await launchpad.provider.getBalance(admin.address)
            const ownerBalance = await launchpad.provider.getBalance(projectOwner.address)
            await time.increaseTo(projectCloseTime)
            expect(await launchpad.connect(admin).collectIDOInvestment(projectID)).emit(launchpad,"ProjectInvestmentCollect").withArgs(projectID)
            expect(await launchpad.provider.getBalance(projectOwner.address)).to.equal(ownerBalance.add(BigNumber.from(ethers.utils.parseEther("1"))))
            expect(await launchpad.provider.getBalance(admin.address)).to.lte(adminBalance.add(BigNumber.from(ethers.utils.parseEther("1"))))
            let projectInvestment = await launchpad.getProjectInvestment(projectID);
            expect(projectInvestment[3]).to.be.equal(true)
        });
        describe("Should revert if", () => {
            it("Project does not exist", async () => {
                await (expect(launchpad.connect(admin).collectIDOInvestment("NoToken")).to.be.revertedWith("Launchpad: invalid Project"))
            });
            it("Caller is not an admin", async () => {
                await (expect(launchpad.connect(add1).collectIDOInvestment(projectID)).to.be.revertedWith("Launchpad: not authorized"))
            });  
            it("Project token is not added", async () => {
                await launchpad.connect(admin).addPublicLaunch(
                    "NoToken",
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    "0x0000000000000000000000000000000000000000",
                    tokenPrice,
                    winnersOutTime,
                    Date.now()+100,
                    Date.now()+200
                )
                await time.increaseTo(Date.now()+100)
                await launchpad.connect(add1).investFairLaunch("NoToken",investment,{ value: ethers.utils.parseEther("2")})
                await time.increaseTo(Date.now()+200)
                await (expect(launchpad.connect(admin).collectIDOInvestment("NoToken")).to.be.revertedWith("Launchpad: Project token not added yet"))
            });
            it("Project is cancelled", async () => {
                await time.increaseTo(projectOpenTime)
                await launchpad.connect(admin).cancelIDO(projectID)
                await time.increaseTo(projectCloseTime)
                await (expect(launchpad.connect(admin).collectIDOInvestment(projectID)).to.be.revertedWith("Launchpad: Project is cancelled"))
            }); 
            it("Project is open", async () => {
                await time.increaseTo(projectOpenTime)
                await (expect(launchpad.connect(admin).collectIDOInvestment(projectID)).to.be.revertedWith("Launchpad: Project is open"))
            });
            it("Investment was already collected", async () => {
                await time.increaseTo(projectCloseTime)
                await launchpad.connect(admin).collectIDOInvestment(projectID)
                await (expect(launchpad.connect(admin).collectIDOInvestment(projectID)).to.be.revertedWith("Launchpad: Project investment already collected"))
            });   
        });    
    });
    describe("Cancel Launch", () => {
        let investment, projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, tokensForDistribution, winnersOutTime, projectOpenTime, projectCloseTime
        beforeEach(async () => {
            investment = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            await launchpad.connect(admin).addPaymentToken(payToken.address);
            projectID = "first";
            targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            minInvestmentAmount = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            winnersOutTime = 0
            projectOpenTime = currentTime+100
            projectCloseTime = projectOpenTime+200
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,tokensForDistribution)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(tokensForDistribution)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )
            await time.increaseTo(projectOpenTime)
        });
        it("Cancel a project and return project tokens", async () => {
            let allocatedTokens = await launchpad.estimateProjectTokensById(projectID,targetAmount)
            expect(await token.connect(admin).balanceOf(launchpad.address)).to.be.equal(tokensForDistribution)
            expect(await launchpad.connect(admin).cancelIDO(projectID)).emit(launchpad,"ProjectCancel").withArgs(projectID)
            expect(await token.connect(admin).balanceOf(launchpad.address)).to.be.equal(0)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(allocatedTokens)
        });
        describe("Should revert if", () => {
            it("Caller is not an admin", async () => {
                await (expect (launchpad.connect(add1).cancelIDO(projectID)).to.be.revertedWith("Launchpad: not authorized"))
            });
            it("Project does not exist", async () => {
                await (expect (launchpad.connect(admin).cancelIDO("NonExistant")).to.be.revertedWith("Launchpad: invalid Project"))
            });
            it("Project is already cancelled", async () => {
                await launchpad.connect(admin).cancelIDO(projectID)
                await (expect (launchpad.connect(admin).cancelIDO(projectID)).to.be.revertedWith("Launchpad: Project already cancelled"))
            });
            it("Project is closed", async () => {
                await time.increaseTo(projectCloseTime)
                await (expect (launchpad.connect(admin).cancelIDO(projectID)).to.be.revertedWith("Launchpad: Project is closed"))
            });
        });    
    });
    describe("Refund Investment", () => {
        let investment, projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, tokensForDistribution, winnersOutTime, projectOpenTime, projectCloseTime
        beforeEach(async () => {
            investment = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            await launchpad.connect(admin).addPaymentToken(payToken.address);
            projectID = "first";
            targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            minInvestmentAmount = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(tokenPrice)
            const currentTime = Date.now()
            winnersOutTime = 0
            projectOpenTime = currentTime+100
            projectCloseTime = projectOpenTime+200
            await token.connect(projectOwner).mint(projectOwner.address,tokensForDistribution)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(tokensForDistribution)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                projectOpenTime,
                projectCloseTime
            )
            await time.increaseTo(projectOpenTime)
        });
        it("Refund an investment made in BNB", async () => {
            await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
            await launchpad.connect(admin).cancelIDO(projectID)
            const previousContractBalance =  await launchpad.provider.getBalance(launchpad.address)
            const previousUserBalance = await launchpad.provider.getBalance(add1.address)
            expect(await launchpad.connect(add1).refundInvestment(projectID)).emit(launchpad,"ProjectInvestmentRefund").withArgs(projectID, add1.address,investment)
            let investor = await launchpad.getInvestor(projectID, add1.address);
            expect(investor[2]).to.be.equal(true)
            let project = await launchpad.getProject(projectID);
            expect(project[10]).to.be.equal(true)
            expect(await launchpad.provider.getBalance(add1.address)).to.lte(previousUserBalance.add(investment))
            expect(await launchpad.provider.getBalance(launchpad.address)).to.equal(previousContractBalance.sub(investment))
        });
        it("Refund an investment made in ERC-20 token", async () => {
            await token.connect(projectOwner).mint(projectOwner.address,tokensForDistribution)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
            await launchpad.connect(admin).addPublicLaunch(
                "Refund",
                projectOwner.address,
                payToken.address,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                winnersOutTime,
                Date.now()+100,
                Date.now()+200
            )
            await payToken.connect(add1).mint(add1.address,investment)
            await time.increaseTo(Date.now()+100)
            await payToken.connect(add1).approve(launchpad.address, investment)
            await launchpad.connect(add1).investFairLaunch("Refund",investment)
            const previousUserBalance =  await payToken.connect(add1).balanceOf(add1.address)
            const previousContractBalance =  await payToken.connect(admin).balanceOf(launchpad.address)
            await launchpad.connect(admin).cancelIDO("Refund")
            expect(await launchpad.connect(add1).refundInvestment("Refund")).emit(launchpad,"ProjectInvestmentRefund").withArgs("Refund", add1.address,investment)
            let investor = await launchpad.getInvestor("Refund", add1.address);
            expect(investor[2]).to.be.equal(true)
            let project = await launchpad.getProject("Refund");
            expect(project[10]).to.be.equal(true)
            expect(await payToken.balanceOf(add1.address)).to.equal(previousUserBalance.add(investment))
            expect(await payToken.balanceOf(launchpad.address)).to.equal(previousContractBalance.sub(investment))
        }); 
        describe("Should revert if", () => {
            it("Project does not exist", async () => {
                await (expect(launchpad.connect(admin).refundInvestment("NonExistant")).to.be.revertedWith("Launchpad: invalid Project"))
            });
            it("Project is not cancelled", async () => {
                await (expect(launchpad.connect(admin).refundInvestment(projectID)).to.be.revertedWith("Launchpad: Project is not cancelled"))
            });
            it("User has already claimed a refund", async () => {
                await launchpad.connect(add1).investFairLaunch(projectID,investment,{ value: ethers.utils.parseEther("2")})
                await launchpad.connect(admin).cancelIDO(projectID)
                await launchpad.connect(add1).refundInvestment(projectID)
                await (expect(launchpad.connect(add1).refundInvestment(projectID)).to.be.revertedWith("Launchpad: already refunded"))
            });
            it("User has no investments", async () => {
                await launchpad.connect(admin).cancelIDO(projectID)
                await (expect(launchpad.connect(admin).refundInvestment(projectID)).to.be.revertedWith("Launchpad: no investment found"))
            });
        }); 
    });
    describe("Launch with presale round", () => {
        let investment, projectID, paymentToken, targetAmount, minInvestmentAmount, tokenPrice, presaleTokenPrice, tokensForDistribution, winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime
        beforeEach(async () => {
            investment = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            paymentToken = "0x0000000000000000000000000000000000000000";
            await launchpad.connect(admin).addPaymentToken(paymentToken);
            await launchpad.connect(admin).addPaymentToken(payToken.address);
            projectID = "first";
            targetAmount = BigNumber.from(10000).mul(BigNumber.from(10).pow(18))
            minInvestmentAmount = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            tokenPrice = BigNumber.from(2).mul(BigNumber.from(10).pow(18))
            presaleTokenPrice = BigNumber.from(1).mul(BigNumber.from(10).pow(18))
            tokensForDistribution = targetAmount.mul(BigNumber.from(10).pow(18)).div(presaleTokenPrice)
            const currentTime = Date.now()
            winnersOutTime = currentTime+100
            presaleEndTime = winnersOutTime + 100
            projectOpenTime = presaleEndTime + 300
            projectCloseTime = projectOpenTime+500
            const mintValue = BigNumber.from(1000000).mul(BigNumber.from(10).pow(18))
            await token.connect(projectOwner).mint(projectOwner.address,mintValue)
            expect(await token.connect(projectOwner).balanceOf(projectOwner.address)).to.be.equal(mintValue)
            await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
        });
        it("Add Presale Project with investments in native currency", async () => {
            await expect(launchpad.connect(admin).addPresaleLaunch(
                projectID,
                projectOwner.address,
                paymentToken,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                presaleTokenPrice,
                [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            paymentToken,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime)
            .to.emit(launchpad,"NotifyPresaleData").withArgs(projectID,winnersOutTime,presaleEndTime,presaleTokenPrice);                                                
        });
        it("Add Presale Project with investments in ERC20 token", async () => {
            await expect(launchpad.connect(admin).addPresaleLaunch(
                projectID,
                projectOwner.address,
                payToken.address,
                targetAmount,
                minInvestmentAmount,
                token.address,
                tokenPrice,
                presaleTokenPrice,
                [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            payToken.address,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            token.address,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime)
            .to.emit(launchpad,"NotifyPresaleData").withArgs(projectID,winnersOutTime,presaleEndTime,presaleTokenPrice);                                                
        })
        describe("Should revert if", () => {
            beforeEach(async () => {
                await launchpad.connect(admin).addPresaleLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )
            });
            it("Caller is not an admin", async () => {
                await (expect(launchpad.connect(add1).addPresaleLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )).to.be.revertedWith("Launchpad: not authorized"))
            });
            it("Project already exists", async () => {
                await (expect(launchpad.connect(admin).addPresaleLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )).to.be.revertedWith("Launchpad: Project id already exist"))
            });
            it("Payment token is not supported", async () => {
                await (expect(launchpad.connect(admin).addPresaleLaunch(
                    "PaymentToken",
                    projectOwner.address,
                    token.address,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )).to.be.revertedWith("Launchpad: payment token not supported"))
            });
            it("Target amount is zero", async () => {
                await (expect(launchpad.connect(admin).addPresaleLaunch(
                    "TargetAmount",
                    projectOwner.address,
                    paymentToken,
                    0,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )).to.be.revertedWith("Launchpad: target amount zero"))
            });
            it("Token price is zero", async () => {
                await (expect(launchpad.connect(admin).addPresaleLaunch(
                    "TokenPrice",
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    0,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )).to.be.revertedWith("Launchpad: token price zero"))
            });
            it("Timestamps are invalid", async () => {
                await (expect(launchpad.connect(admin).addPresaleLaunch(
                    "Timestamps",
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [presaleEndTime, winnersOutTime,  projectOpenTime, projectCloseTime]
                )).to.be.revertedWith("Launchpad: Project invalid timestamps"))
            });    
        });
        it("Add Presale Project without a project token", async () => {
            await expect(launchpad.connect(admin).addPresaleLaunch(
                projectID,
                projectOwner.address,
                payToken.address,
                targetAmount,
                minInvestmentAmount,
                paymentToken,
                tokenPrice,
                presaleTokenPrice,
                [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
            )).to.emit(launchpad,"ProjectAdd").withArgs(projectID,
                                                            projectOwner.address,
                                                            payToken.address,
                                                            targetAmount,
                                                            minInvestmentAmount,
                                                            paymentToken,
                                                            tokenPrice,
                                                            winnersOutTime,
                                                            projectOpenTime,
                                                            projectCloseTime)
            .to.emit(launchpad,"NotifyPresaleData").withArgs(projectID,winnersOutTime,presaleEndTime,presaleTokenPrice);
        });
        describe("Edit Launch with presale round", () => {
            beforeEach(async () => {
                await launchpad.connect(admin).addPresaleLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )
            });
            it("Change timestamps of an added presale launch", async () => {
                newPresaleStart = winnersOutTime + 300
                newPresaleEnd = presaleEndTime + 300
                newOpenTime = projectOpenTime + 300
                newCloseTime = projectCloseTime + 300
                await expect(launchpad.connect(admin).editPresaleProject(
                    projectID,
                    projectOwner.address,
                    payToken.address,
                    minInvestmentAmount,
                    paymentToken,
                    [newPresaleStart, newPresaleEnd, newOpenTime, newCloseTime]
                )).to.emit(launchpad,"ProjectEdit").withArgs(projectID,
                                                                paymentToken,
                                                                newOpenTime,
                                                                newCloseTime)
                .to.emit(launchpad,"NotifyPresaleData").withArgs(projectID,newPresaleStart,newPresaleEnd,presaleTokenPrice);                                                
            });
            it("Change project token address from zero to valid address", async () => {
                await launchpad.connect(admin).addPresaleLaunch(
                    "ValidToken",
                    projectOwner.address,
                    payToken.address,
                    targetAmount,
                    minInvestmentAmount,
                    paymentToken,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )
                await token.connect(projectOwner).approve(launchpad.address, tokensForDistribution)
                await expect(launchpad.connect(admin).editPresaleProject(
                    "ValidToken",
                    projectOwner.address,
                    payToken.address,
                    minInvestmentAmount,
                    token.address,
                    [newPresaleStart, newPresaleEnd, newOpenTime, newCloseTime]
                )).to.emit(launchpad,"ProjectEdit").withArgs("ValidToken",
                                                                token.address,
                                                                newOpenTime,
                                                                newCloseTime)
                .to.emit(launchpad,"NotifyPresaleData").withArgs("ValidToken",newPresaleStart, newPresaleEnd,presaleTokenPrice);                                             
            });
            describe("Should revert if", () => {
                it("Caller is not an admin", async () => {
                    await expect(launchpad.connect(add1).editPresaleProject(
                        projectID,
                        projectOwner.address,
                        payToken.address,
                        minInvestmentAmount,
                        paymentToken,
                        [newPresaleStart, newPresaleEnd, newOpenTime, newCloseTime]
                    )).to.be.revertedWith("Launchpad: not authorized")
                });
                it("Project does not exist", async () => {
                    await expect(launchpad.connect(admin).editPresaleProject(
                        "Nonexistant",
                        projectOwner.address,
                        payToken.address,
                        minInvestmentAmount,
                        paymentToken,
                        [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                    )).to.be.revertedWith("Launchpad: Project does not exist")
                });
                it("Project owner has zero address", async () => {
                    await expect(launchpad.connect(admin).editPresaleProject(
                        projectID,
                        paymentToken,
                        payToken.address,
                        minInvestmentAmount,
                        paymentToken,
                        [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                    )).to.be.revertedWith("Launchpad: Project owner zero")
                });
                it("Payment token is not supported", async () => {
                    await expect(launchpad.connect(admin).editPresaleProject(
                        projectID,
                        projectOwner.address,
                        "0x82763843d660d74CD80D69720dd471B4c2A93171",
                        minInvestmentAmount,
                        paymentToken,
                        [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                    )).to.be.revertedWith("Launchpad: payment token not supported")
                });
                it("Timestamps are invalid", async () => {
                    await expect(launchpad.connect(admin).editPresaleProject(
                        projectID,
                        projectOwner.address,
                        payToken.address,
                        minInvestmentAmount,
                        paymentToken,
                        [presaleEndTime, winnersOutTime, projectOpenTime, projectCloseTime]
                    )).to.be.revertedWith("Launchpad: Project invalid timestamps")
                });
                it("Project token is changed", async () => {
                    await expect(launchpad.connect(admin).editPresaleProject(
                        projectID,
                        projectOwner.address,
                        payToken.address,
                        minInvestmentAmount,
                        payToken.address,
                        [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                    )).to.be.revertedWith("Launchpad: Project token already added")
                });
            });
        });
        describe("Invest in presale round", () => {
            beforeEach(async () => {
                await launchpad.connect(admin).addPresaleLaunch(
                    projectID,
                    projectOwner.address,
                    paymentToken,
                    targetAmount,
                    minInvestmentAmount,
                    token.address,
                    tokenPrice,
                    presaleTokenPrice,
                    [winnersOutTime, presaleEndTime, projectOpenTime, projectCloseTime]
                )
            });
            it("Invest in a presale launch with BNB", async () => {
                function encodeLeaf(address) {
                    // Same as `abi.encodePacked` in Solidity
                    return ethers.utils.defaultAbiCoder.encode(["address"],[address]);
                }
                const list = [encodeLeaf(add1.address)]
                const invalidList = [encodeLeaf(add2.address)]
                const merkleTree = new MerkleTree(list, keccak256, {
                    hashLeaves: true,
                    sortPairs: true,
                });
                const root = merkleTree.getHexRoot();
                const leaf = keccak256(list[0]);
                const invalidLeaf = keccak256(invalidList[0]);
                const proof = merkleTree.getHexProof(leaf);
                const invalidProof = merkleTree.getHexProof(invalidLeaf);
                const previousUserBalance =  await launchpad.provider.getBalance(add1.address)
                const previousLpadBalance =  await launchpad.provider.getBalance(launchpad.address)
                await time.increaseTo(winnersOutTime)
                await expect(launchpad.connect(admin).addMerkleRoot(projectID,root)).to.emit(launchpad,"SetMerkleRoot").withArgs(projectID,root)
                await expect(launchpad.connect(add1).investPresale(projectID, proof ,investment,{ value: ethers.utils.parseEther("2") })).to.emit(
                    launchpad,"ProjectInvest").withArgs(projectID,add1.address,investment);  
                let projectInvestment = await launchpad.getProjectInvestment(projectID);
                expect(projectInvestment[0]).to.equal(investment)
                expect(projectInvestment[1]).to.equal(0)
                expect(projectInvestment[2]).to.equal(1)
                expect(projectInvestment[3]).to.equal(false)
                let investor = await launchpad.getInvestor(projectID,add1.address)   
                expect(investor[0]).to.equal(investment)
                expect(investor[1]).to.equal(false)
                expect(investor[2]).to.equal(false) 
                expect(await launchpad.provider.getBalance(add1.address)).to.lte(previousUserBalance.sub(BigNumber.from(ethers.utils.parseEther("2"))))
                expect(await launchpad.provider.getBalance(launchpad.address)).to.equal(previousLpadBalance.add(BigNumber.from(ethers.utils.parseEther("2"))))
            });
        });       
    });         
});
    