const hre = require("hardhat");
const { upgrades } = require("hardhat");

const proxyAddress = '0x0000000000000000000000000000000000000000' //Replace with the proxy address after deploying V1 Smart Contract

async function main() {
  console.log(proxyAddress," V1 Proxy Address")
  const StakingV2 = await ethers.getContractFactory("StakingV2")
  console.log("upgrade to StakingV2...")
  const stakingv2 = await upgrades.upgradeProxy(proxyAddress, StakingV2)
  console.log(stakingv2.address," StakingV2 address(should be the same)")

  console.log(await upgrades.erc1967.getImplementationAddress(stakingv2.address)," getImplementationAddress")
  console.log(await upgrades.erc1967.getAdminAddress(stakingv2.address), " getAdminAddress")    
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
