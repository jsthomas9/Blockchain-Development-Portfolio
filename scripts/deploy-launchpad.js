const hre = require("hardhat");

async function main() {
  const lpadInstance = await ethers.getContractFactory("Launchpad");
  const launchpad = await upgrades.deployProxy(lpadInstance);
  await launchpad.waitForDeployment();

  console.log('Vesting Smart Contract deployed to: ', launchpad.getAddress());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
