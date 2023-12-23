const hre = require("hardhat");

async function main() {
  const stakingInstance = await ethers.getContractFactory("Staking");
  const staking = await upgrades.deployProxy(stakingInstance);
  await staking.waitForDeployment();

  console.log('Staking Smart Contract deployed to: ', staking.getAddress());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
