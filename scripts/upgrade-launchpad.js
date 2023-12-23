const hre = require("hardhat");
const { upgrades } = require("hardhat");

const proxyAddress = '0x0000000000000000000000000000000000000000' //Replace with the proxy address after deploying V1 Smart Contract

async function main() {
  console.log(proxyAddress," V1 Proxy Address")
  const LaunchpadV2 = await ethers.getContractFactory("LaunchpadV2")
  console.log("upgrade to LaunchpadV2...")
  const launchpadV2 = await upgrades.upgradeProxy(proxyAddress, LaunchpadV2)
  console.log(launchpadV2.address," LaunchpadV2 address(should be the same)")

  console.log(await upgrades.erc1967.getImplementationAddress(launchpadV2.address)," getImplementationAddress")
  console.log(await upgrades.erc1967.getAdminAddress(launchpadV2.address), " getAdminAddress")    
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})