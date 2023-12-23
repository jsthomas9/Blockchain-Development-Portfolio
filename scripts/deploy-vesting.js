const hre = require("hardhat");

async function main() {
  const vestingInstance = await ethers.getContractFactory("Vesting");
  const vesting = await upgrades.deployProxy(vestingInstance);
  await vesting.waitForDeployment();

  console.log('Vesting Smart Contract deployed to: ', vesting.getAddress());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
