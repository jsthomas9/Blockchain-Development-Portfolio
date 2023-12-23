// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";

/**
 * @title Launchpad smart contract
 * @dev Smart contract houses functions that can be used to launch fund raisers for projects
 * edit their details, invest in launches and claim project tokens
 */

contract Launchpad is ReentrancyGuardUpgradeable {

    using SafeERC20Upgradeable for IERC20Upgradeable;
    // Denominator adjusted with degree of precision = 2
    uint256 private constant PERCENT_DENOMINATOR = 10000;

    struct Project {
        address projectOwner; // Address of the Project owner
        address paymentToken; // Address of the payment token
        uint256 targetAmount; // Funds targeted to be raised for the project
        uint256 minInvestmentAmount; // Minimum amount of payment token that can be invested
        address projectToken; // Address of the Project token
        uint256 tokensForDistribution; // Number of tokens to be distributed
        uint256 tokenPrice; // Token price in payment token (Decimals same as payment token)
        uint256 winnersOutTime; // Timestamp at which winners are announced
        uint256 projectOpenTime; // Timestamp at which the Project is open for investment
        uint256 projectCloseTime; // Timestamp at which the Project is closed
        bool cancelled; // Boolean indicating if Project is cancelled
    }

    struct ProjectInvestment {
        uint256 totalInvestment; // Total investment in payment token
        uint256 totalProjectTokensClaimed; // Total number of Project tokens claimed
        uint256 totalInvestors; // Total number of investors
        bool collected; // Boolean indicating if the investment raised in Project collected
    }

    struct Investor {
        uint256 investment; // Amount of payment tokens invested by the investor
        bool claimed; // Boolean indicating if user has claimed Project tokens
        bool refunded; // Boolean indicating if user is refunded
    }

    address public owner; // Owner of the Smart Contract
    address public potentialOwner; // Potential owner's address
    uint256 public feePercentage; // Percentage of Funds raised to be paid as fee
    uint256 public BNBFromFailedTransfers; // BNB left in the contract from failed transfers
    bytes32 private constant ADMIN = keccak256(abi.encodePacked("ADMIN")); // hashed string for ADMIN role

    /* Mappings */

    // Project ID => Project{}
    mapping(string => Project) private _projects; 

    // Project ID => ProjectInvestment{}
    mapping(string => ProjectInvestment) private _projectInvestments;

    // IDO ID => Its Merkle Root
    mapping(string => bytes32) private _projectMerkleRoots;

    // Project ID => userAddress => Investor{}
    mapping(string => mapping(address => Investor)) private _projectInvestors;

    // tokenAddress => Is token supported as payment
    mapping(address => bool) private _paymentSupported;

    // Role => walletAddress => status
    mapping(bytes32 => mapping(address => bool)) private _roles;

    // Project ID => presale token price
    mapping(string => uint256) private _presalePrices;

    // Project ID => userAddress => Presale round investment
    mapping(string => mapping(address => uint256)) private _presaleInvestments;

    // Project ID => userAddress => Public round investment in a presale launch
    mapping(string => mapping(address => uint256)) private _publicInvestments;

    // Project ID => presaleEndTime
    mapping(string => uint256) private _presaleEndTimes;

    /* Events */

    /// @notice event emitted when a potential owner accepts ownership
    event OwnerChange(address newOwner);

    /// @notice event emitted when a potential owner is added by the owner
    event NominateOwner(address potentialOwner);

    /// @notice event emitted when the owner sets the platform fee
    event SetFeePercentage(uint256 feePercentage);

    /// @notice event emitted when the owner adds a sub admin
    event AddAdmin(address adminAddress);

    /// @notice event emitted when the owner revokes admin rights of a sub admin
    event RevokeAdmin(address adminAddress);

    /// @notice event emitted when the owner adds the merkle root of a project with whitelisting
    event SetMerkleRoot(string projectID, bytes32 merkleRoot);

    /// @notice event emitted when the owner adds a token that can be used to invest
    event AddPaymentToken(address indexed paymentToken);

    /// @notice event emitted when the owner removes a payment token
    event RemovePaymentToken(address indexed paymentToken);

    /// @notice event emitted when the owner adds a new project launch
    event ProjectAdd(
        string projectID,
        address projectOwner,
        address paymentToken,
        uint256 targetAmount,
        uint256 minInvestmentAmount,
        address projectToken,
        uint256 tokenPrice,
        uint256 winnersOutTime,
        uint256 projectOpenTime,
        uint256 projectCloseTime
    );

    /// @notice event emitted to notify presale price of a presale launch
    event NotifyPresaleData(
        string projectID,
        uint256 presaleStartTime,
        uint256 presaleEndTime,
        uint256 presalePrice
    );

    /// @notice event emitted when the owner edits a launch
    event ProjectEdit(
        string projectID, 
        address projectToken, 
        uint256 projectOpenTime, 
        uint256 projectCloseTime);

    /// @notice event emitted when the owner cancels a project launch    
    event ProjectCancel(string projectID);

    /// @notice event emitted when the owner deletes a project
    event ProjectDelete(string projectID);

    /// @notice event emitted when the owner collects the investment raised
    event ProjectInvestmentCollect(string projectID);

    /// @notice event emitted when a user invests in a project
    event ProjectInvest(
        string projectID,
        address indexed investor,
        uint256 investment
    );

    /// @notice event emitted when a user claims project tokens from an invested project
    event ProjectInvestmentClaim(
        string projectID,
        address indexed investor,
        uint256 tokenAmount
    );

    /// @notice event emitted when a user claims refund of investment from a cancelled project
    event ProjectInvestmentRefund(
        string projectID,
        address indexed investor,
        uint256 refundAmount
    );

    /// @notice event emitted when BNB transfer fails
    event TransferOfBNBFail(address indexed receiver, uint256 indexed amount);

    /* Modifiers */

    /// @notice checks if the caller is the owner
    modifier onlyOwner() {
        require(owner == msg.sender, "Launchpad: Only owner allowed");
        _;
    }

    /// @notice checks if the caller is either the owner or a sub admin
    modifier onlyAdmin() {
        require(msg.sender == owner || _roles[ADMIN][msg.sender],
        "Launchpad: not authorized");
        _;
    }

    /// @notice checks if the project exists
    modifier onlyValidProject(string calldata projectID) {
        require(projectExist(projectID), "Launchpad: invalid Project");
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
     * @dev initializing deployer as the owner of the platform
     * Emits an {Initialized} event.
     */
    function initialize() public initializer {
        owner = msg.sender;
    }

    /* Owner Functions */

    /** 
     * @notice This function is used to add an address as an admin
     * @dev Only the platform owner can call this function
     * @param newAdmin Address of the new admin
     */
    function grantRole(address newAdmin) external onlyOwner {
        _addAdmin(ADMIN, newAdmin);
    }

    /** 
     * @notice This function is used to remove an admin
     * @dev Only the platform owner can call this function
     * @param adminAddress Address of the admin
     */
    function revokeRole(address adminAddress) external onlyOwner {
        _removeAdmin(ADMIN, adminAddress);
    }

    /**
     * @notice This function is used to add a potential owner of the contract
     * @dev Only the owner can call this function
     * @param _potentialOwner Address of the potential owner
     */
    function addPotentialOwner(address _potentialOwner) external onlyOwner {
        require(
            _potentialOwner != address(0),
            "Launchpad: potential owner zero"
        );
        require(
            _potentialOwner != owner,
            "Launchpad: potential owner same as owner"
        );
        potentialOwner = _potentialOwner;
        emit NominateOwner(_potentialOwner);
    }

    /**
     * @notice This function is used to accept ownership of the contract
     * @dev only an address nominated as a potential owner can call this function
     */
    function acceptOwnership() external {
        require(
            msg.sender == potentialOwner,
            "Launchpad: only potential owner"
        );
        owner = potentialOwner;
        delete potentialOwner;
        emit OwnerChange(owner);
    }

    /**
     * @notice This method is used to set Merkle Root of an IDO
     * @dev This method can only be called by the platform owner
     * @param projectID ID of the IDO
     * @param merkleRoot Merkle Root of the IDO
     */
    function addMerkleRoot(string calldata projectID, bytes32 merkleRoot) 
        external 
        onlyValidProject(projectID)
        onlyAdmin(){
        
        require(
            _projects[projectID].winnersOutTime <= block.timestamp,
            "Launchpad: cannot update before whitelisting closes"
        );
        require(
            _projectMerkleRoots[projectID] == bytes32(0),
            "Launchpad: merkle root already added"
        );
        _projectMerkleRoots[projectID] = merkleRoot;
        emit SetMerkleRoot(projectID, merkleRoot);
    }

    /**
     * @notice This method is used to set commission percentage for the launchpad
     * @dev The fee should be beteen the range of 0% and 100%
     * @param _feePercentage Percentage from raised funds to be set as fee
     */
    function setFee(uint256 _feePercentage) external onlyAdmin(){

        require(
            _feePercentage <= 10000,
            "Launchpad: fee Percentage should be less than 10000"
        );
        feePercentage = _feePercentage;
        emit SetFeePercentage(_feePercentage);
    }

    /* Payment Token */

    /**
     * @notice This method is used to add Payment token
     * @param _paymentToken Address of payment token to be added
     */
    function addPaymentToken(address _paymentToken) external onlyAdmin(){
        require(
            !_paymentSupported[_paymentToken],
            "Launchpad: token already added"
        );
        _paymentSupported[_paymentToken] = true;
        emit AddPaymentToken(_paymentToken);
    }

    /**
     * @notice This method is used to remove Payment token
     * @param _paymentToken Address of payment token to be removed
     */
    function removePaymentToken(address _paymentToken) external onlyAdmin(){
        require(
            _paymentSupported[_paymentToken],
            "Launchpad: token not added"
        );
        _paymentSupported[_paymentToken] = false;
        emit RemovePaymentToken(_paymentToken);
    }

    /**
     * @notice This method is to collect any BNB left from failed transfers.
     * @dev This method can only be called by the contract owner
     */
    function collectBNBFromFailedTransfers() external onlyAdmin(){
        uint256 bnbToSend = BNBFromFailedTransfers;
        BNBFromFailedTransfers = 0;
        (bool success, ) = payable(owner).call{value: bnbToSend}("");
        require(success, "Launchpad: BNB transfer failed");
    }

    /* Project */

    /**
     * @notice This method is used to add a new Public project
     * @dev This method can only be called by the contract owner
     * @dev Any investor can invest without the need to be whitelisted beforehand
     * @dev Project token address can be added or zero address can be passed to add it later
     * @param projectID ID of the Project to be added
     * @param projectOwner Address of the Project owner
     * @param paymentToken Payment token to be used for the Project
     * @param targetAmount Targeted amount to be raised in Project
     * @param minInvestmentAmount Minimum amount of payment token that can be invested in Project
     * @param projectToken Address of Project token
     * @param tokenPrice Project token price in terms of payment token
     * @param presaleStartTime Beginning of pre-sale round. 0 for public launch
     * @param projectOpenTime Project open timestamp
     * @param projectCloseTime Project close timestamp
     */
    function addPublicLaunch(
        string calldata projectID,
        address projectOwner,
        address paymentToken,
        uint256 targetAmount,
        uint256 minInvestmentAmount,
        address projectToken,
        uint256 tokenPrice,
        uint256 presaleStartTime,
        uint256 projectOpenTime,
        uint256 projectCloseTime
    ) external 
      onlyAdmin()
      nonReentrant{
        require(
            !projectExist(projectID),
            "Launchpad: Project id already exist"
        );
        require(
            projectOwner != address(0),
            "Launchpad: Project owner zero"
        );
        require(
            _paymentSupported[paymentToken],
            "Launchpad: payment token not supported"
        );
        require(targetAmount != 0, "Launchpad: target amount zero");
        require(tokenPrice != 0, "Launchpad: token price zero");
        require(presaleStartTime == 0, "Launchpad: presale time not zero");
        require(block.timestamp < projectOpenTime 
                && projectOpenTime < projectCloseTime,
            "Launchpad: Project invalid timestamps"
        );

        uint256 tokensForDistribution = projectToken == address(0)
                ? 0
                : estimateProjectTokens(
                projectToken,
                tokenPrice,
                targetAmount);
 

            _projects[projectID] = Project(
            projectOwner,
            paymentToken,
            targetAmount,
            minInvestmentAmount,
            projectToken,
            tokensForDistribution,
            tokenPrice,
            presaleStartTime,
            projectOpenTime,
            projectCloseTime,
            false
        );
        if(projectToken != address(0))
        {
            IERC20Upgradeable(projectToken).safeTransferFrom(
                projectOwner,
                address(this),
                tokensForDistribution
            );
        }    

        emit ProjectAdd(projectID, 
                        projectOwner,
                        paymentToken,
                        targetAmount,
                        minInvestmentAmount,
                        projectToken,
                        tokenPrice,
                        presaleStartTime,
                        projectOpenTime,
                        projectCloseTime);
    }

    /**
     * @notice This method is used to add a new project with presale round
     * @dev This method can only be called by the contract owner
     * @dev A specific number of whitelisted users can invest early in pre sale rounds
     * @dev Post whitelist investment any user can invest in the launch without getting whitelisted
     * beforehand
     * @dev Project token address can be added or zero address can be passed to add it later
     * @param projectID ID of the Project to be added
     * @param projectOwner Address of the Project owner
     * @param paymentToken Payment token to be used for the Project
     * @param targetAmount Targeted amount to be raised in Project
     * @param minInvestmentAmount Minimum amount of payment token that can be invested in Project
     * @param projectToken Address of Project token
     * @param tokenPrice Project token price in terms of payment token
     * @param presaleTokenPrice Project token price for presale round
     * @param timeStamps Array of project timestamps
     * timeStamps[0] = presaleStartTime
     * timeStamps[1] = presaleEndTime
     * timeStamps[2] = projectOpenTime
     * timeStamps[3] = projectCloseTime
     */
    function addPresaleLaunch(
        string calldata projectID,
        address projectOwner,
        address paymentToken,
        uint256 targetAmount,
        uint256 minInvestmentAmount,
        address projectToken,
        uint256 tokenPrice,
        uint256 presaleTokenPrice,
        uint256[4] calldata timeStamps
    ) external 
      onlyAdmin()
      nonReentrant{
        require(
            !projectExist(projectID),
            "Launchpad: Project id already exist"
        );
        require(
            projectOwner != address(0),
            "Launchpad: Project owner zero"
        );
        require(
            _paymentSupported[paymentToken],
            "Launchpad: payment token not supported"
        );
        require(targetAmount != 0, "Launchpad: target amount zero");
        require(tokenPrice != 0, "Launchpad: token price zero");
        require(
                block.timestamp < timeStamps[0] &&
                timeStamps[0] < timeStamps[1] &&
                timeStamps[1] <= timeStamps[2] &&
                timeStamps[2] < timeStamps[3],
            "Launchpad: Project invalid timestamps"
        );

        uint256 tokensForDistribution = projectToken == address(0)
                ? 0
                : estimateProjectTokens(
                projectToken,
                presaleTokenPrice,
                targetAmount);
 
            _projects[projectID] = Project(
            projectOwner,
            paymentToken,
            targetAmount,
            minInvestmentAmount,
            projectToken,
            tokensForDistribution,
            tokenPrice,
            timeStamps[0],
            timeStamps[2],
            timeStamps[3],
            false
        );
        _presalePrices[projectID] = presaleTokenPrice;
        _presaleEndTimes[projectID] = timeStamps[1];
        if(projectToken != address(0))
        {
            IERC20Upgradeable(projectToken).safeTransferFrom(
                projectOwner,
                address(this),
                tokensForDistribution
            );
        }    
        emit ProjectAdd(projectID, 
                        projectOwner,
                        paymentToken,
                        targetAmount,
                        minInvestmentAmount,
                        projectToken,
                        tokenPrice,
                        timeStamps[0],
                        timeStamps[2],
                        timeStamps[3]);
        emit NotifyPresaleData(projectID, timeStamps[0], timeStamps[1], presaleTokenPrice);               
    }

    /**
     * @notice This method is used to edit a Public project
     * @dev This method can only be called by the contract owner
     * @dev Project token address can be added or zero address can be passed to add it later
     * @dev Adding a project token would initialize a transfer and project token can only be added once
     * @param projectID ID of the Project to be added
     * @param projectOwner Address of the Project owner
     * @param paymentToken Payment token to be used for the Project
     * @param targetAmount Targeted amount to be raised in Project
     * @param minInvestmentAmount Minimum amount of payment token that can be invested in Project
     * @param projectToken Address of Project token
     * @param tokenPrice Project token price in terms of payment token
     * @param presaleStartTime Beginning of pre-sale round. 0 for public launch
     * @param projectOpenTime Project open timestamp
     * @param projectCloseTime Project close timestamp
     */
    function editPublicProject(
        string calldata projectID,
        address projectOwner,
        address paymentToken,
        uint256 targetAmount,
        uint256 minInvestmentAmount,
        address projectToken,
        uint256 tokenPrice,
        uint256 presaleStartTime,
        uint256 projectOpenTime,
        uint256 projectCloseTime
    ) external
      onlyAdmin()
      nonReentrant{
        require(
            projectExist(projectID),
            "Launchpad: Project does not exist"
        );
        require(
            projectOwner != address(0),
            "Launchpad: Project owner zero"
        );
        require(
            _paymentSupported[paymentToken],
            "Launchpad: payment token not supported"
        );
        require(targetAmount != 0, "Launchpad: target amount zero");
        require(tokenPrice != 0, "Launchpad: token price zero");
        require(presaleStartTime == 0, "Launchpad: presale time not zero");
        require(projectOpenTime < projectCloseTime,
            "Launchpad: invalid timestamps"
        );

        uint256 tokensForDistribution;
        if(projectToken != address(0) && _projects[projectID].projectToken == address(0))
        {
            tokensForDistribution = estimateProjectTokens(
                        projectToken,
                        tokenPrice,
                        targetAmount);
            IERC20Upgradeable(projectToken).safeTransferFrom(
                projectOwner,
                address(this),
                tokensForDistribution
            );            
        }
        else if(projectToken != address(0) && _projects[projectID].projectToken != address(0))
        {
            require(projectToken == _projects[projectID].projectToken,
                    "Launchpad: Project token already added");
            tokensForDistribution = _projects[projectID].tokensForDistribution;
        }
        else {
            tokensForDistribution = 0;
        }

            _projects[projectID] = Project(
            projectOwner,
            paymentToken,
            targetAmount,
            minInvestmentAmount,
            projectToken,
            tokensForDistribution,
            tokenPrice,
            presaleStartTime,
            projectOpenTime,
            projectCloseTime,
            false
        );  
        emit ProjectEdit(projectID,projectToken,projectOpenTime,projectCloseTime);
      }

    /**
     * @notice This method is used to edit a project with pre sale round
     * @dev This method can only be called by the contract owner
     * @dev Project token address can be added or zero address can be passed to add it later
     * @dev Adding a project token would initialize a transfer and project token can only be added once
     * @param projectID ID of the Project to be added
     * @param projectOwner Address of the Project owner
     * @param paymentToken Payment token to be used for the Project
     * @param minInvestmentAmount Minimum amount of payment token that can be invested in Project
     * @param projectToken Address of Project token
     * @param timeStamps Array of project timestamps
     * timeStamps[0] = presaleStartTime
     * timeStamps[1] = presaleEndTime
     * timeStamps[2] = projectOpenTime
     * timeStamps[3] = projectCloseTime
     */
    function editPresaleProject(
        string calldata projectID,
        address projectOwner,
        address paymentToken,
        uint256 minInvestmentAmount,
        address projectToken,
        uint256[4] calldata timeStamps
    ) external
      onlyAdmin()
      nonReentrant{
        require(
            projectExist(projectID),
            "Launchpad: Project does not exist"
        );
        require(
            projectOwner != address(0),
            "Launchpad: Project owner zero"
        );
        require(
            _paymentSupported[paymentToken],
            "Launchpad: payment token not supported"
        );
        require(
                block.timestamp < timeStamps[0] &&
                timeStamps[0] < timeStamps[1] &&
                timeStamps[1] <= timeStamps[2] &&
                timeStamps[2] < timeStamps[3],
            "Launchpad: Project invalid timestamps"
        );

        uint256 tokensForDistribution;
        if(projectToken != address(0) && _projects[projectID].projectToken == address(0))
        {
            tokensForDistribution = estimateProjectTokens(
                        projectToken,
                        _presalePrices[projectID],
                        _projects[projectID].targetAmount);
            IERC20Upgradeable(projectToken).safeTransferFrom(
                projectOwner,
                address(this),
                tokensForDistribution
            );            
        }
        else if(projectToken != address(0) && _projects[projectID].projectToken != address(0))
        {
            require(projectToken == _projects[projectID].projectToken,
                    "Launchpad: Project token already added");
            tokensForDistribution = _projects[projectID].tokensForDistribution;
        }
        else {
            tokensForDistribution = 0;
        }

        _projects[projectID] = Project(
        projectOwner,
        paymentToken,
        _projects[projectID].targetAmount,
        minInvestmentAmount,
        projectToken,
        tokensForDistribution,
        _projects[projectID].tokenPrice,
        timeStamps[0],
        timeStamps[2],
        timeStamps[3],
        false
        );
        _presaleEndTimes[projectID] = timeStamps[1];   
        emit ProjectEdit(projectID,projectToken,timeStamps[2],timeStamps[3]);
        emit NotifyPresaleData(projectID, timeStamps[0], timeStamps[1], _presalePrices[projectID]);
      }

    /**
     * @notice This method is used to cancel an Project
     * @dev This method can only be called by the contract owner
     * @param projectID ID of the Project
     */
    function cancelIDO(string calldata projectID)
        external
        onlyValidProject(projectID)
        onlyAdmin()
    {
        Project memory project = _projects[projectID];
        require(
            !project.cancelled,
            "Launchpad: Project already cancelled"
        );
        require(
            block.timestamp < project.projectCloseTime,
            "Launchpad: Project is closed"
        );

        _projects[projectID].cancelled = true;
        if(project.projectToken != address(0)){
            IERC20Upgradeable(project.projectToken).safeTransfer(
                project.projectOwner,
                project.tokensForDistribution
            );
        }
        emit ProjectCancel(projectID);
    }

    /**
     * @notice This method is used to delete a Project before it opens up for investment
     * @dev This method can only be called by the contract owner
     * @param projectID ID of the Project
     */
    function deleteIDO(string calldata projectID)
        external
        onlyValidProject(projectID)
        onlyAdmin()
    {
        Project memory project = _projects[projectID];
        require(
            !project.cancelled,
            "Launchpad: Project already cancelled"
        );
        require(
            block.timestamp < project.projectOpenTime,
            "Launchpad: Project is open"
        );

        _projects[projectID].cancelled = true;
        if(project.projectToken != address(0)){
            IERC20Upgradeable(project.projectToken).safeTransfer(
                project.projectOwner,
                project.tokensForDistribution
            );
        }
        emit ProjectDelete(projectID);
    }

    /**
     * @notice This method is used to distribute investment raised in launch to project owner
     * @dev This method can only be called by the contract owner
     * @dev Platform commission based on feePercentage will be transferred to the platform owner
     * @param projectID ID of the Project
     */
    function collectIDOInvestment(string calldata projectID)
        external
        onlyValidProject(projectID)
        onlyAdmin()
    {
        Project memory project = _projects[projectID];
        require(project.projectToken != address(0),
                "Launchpad: Project token not added yet");
        require(!project.cancelled, "Launchpad: Project is cancelled");
        require(
            block.timestamp > project.projectCloseTime,
            "Launchpad: Project is open"
        );

        ProjectInvestment memory projectInvestment = _projectInvestments[
            projectID
        ];

        require(
            !projectInvestment.collected,
            "Launchpad: Project investment already collected"
        );

        _projectInvestments[projectID].collected = true;

        if(projectInvestment.totalInvestment == 0){
            IERC20Upgradeable(project.projectToken).safeTransfer(
            project.projectOwner,
            project.tokensForDistribution
        );
        }
        else{
            uint256 platformShare = feePercentage == 0
                ? 0
                : (feePercentage * projectInvestment.totalInvestment) /
                    PERCENT_DENOMINATOR;

            _projectInvestments[projectID].collected = true;

            transferTokens(owner, project.paymentToken, platformShare);
            transferTokens(
                project.projectOwner,
                project.paymentToken,
                projectInvestment.totalInvestment - platformShare
            );

            uint256 price = _presalePrices[projectID] == 0
                ? project.tokenPrice
                : _presalePrices[projectID];
            uint256 projectTokensLeftover = project.tokensForDistribution -
                estimateProjectTokens(
                    project.projectToken,
                    price,
                    projectInvestment.totalInvestment
                );
            transferTokens(
                project.projectOwner,
                project.projectToken,
                projectTokensLeftover
            );
        } 

        emit ProjectInvestmentCollect(projectID);
    }
    /* Owner Functions end */

    /* View */

    /**
     * @dev This helper method is used to validate whether the address is whitelisted or not
     * @param merkleRoot Merkle Root of the IDO
     * @param merkleProof Merkle Proof of the user for that IDO
     */
    function _isWhitelisted(bytes32 merkleRoot, bytes32[] calldata merkleProof)
        private
        view
        returns (bool)
    {
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
        return MerkleProofUpgradeable.verify(merkleProof, merkleRoot, leaf);
    }

    /**
     * @notice This method is used to check if a payment token is supported
     * @param _paymentToken Address of the token
     */
    function isPaymentTokenSupported(address _paymentToken)
        external
        view
        returns (bool)
    {
        return _paymentSupported[_paymentToken];
    }

    /**
     * @notice This method is used to check if a Project exist
     * @param projectID ID of the Project
     * @return bool whether the given projectID exists or not
     */
    function projectExist(string calldata projectID)
        public
        view
        returns (bool)
    {
        return _projects[projectID].projectOwner != address(0) ? true : false;
    }

    /**
     * @notice This method is used to get Project details
     * @param projectID ID of the Project
     * @return the Project record for the particular projectID
     */
    function getProject(string calldata projectID)
        external
        view
        onlyValidProject(projectID)
        returns (Project memory)
    {
        return _projects[projectID];
    }

    /**
     * @notice This method is used to get Project Investment details
     * @param projectID ID of the Project
     * @return ProjectInvestment record for the particular projectID
     */
    function getProjectInvestment(string calldata projectID)
        external
        view
        onlyValidProject(projectID)
        returns (ProjectInvestment memory)
    {
        return _projectInvestments[projectID];
    }

    /**
     * @notice This method is used to get Project Investment details of an investor
     * @param projectID ID of the Project
     * @param investor Address of the investor
     * @return Investor record for an investor for a particular projectID
     */
    function getInvestor(string calldata projectID, address investor)
        external
        view
        onlyValidProject(projectID)
        returns (Investor memory)
    {
        return _projectInvestors[projectID][investor];
    }

    /**
     * @notice Helper function to estimate Project token amount for payment
     * @param amount Amount of payment tokens
     * @param projectToken Address of the Project token
     * @param tokenPrice Price for Project token
     */
    function estimateProjectTokens(
        address projectToken,
        uint256 tokenPrice,
        uint256 amount
    ) public view returns (uint256 projectTokenCount) {
        require(projectToken != address(0), "Launchpad: token address zero");
        uint256 projectTokenDecimals = uint256(
            IERC20MetadataUpgradeable(projectToken).decimals()
        );
        projectTokenCount = (amount * 10**projectTokenDecimals) / tokenPrice;
    }

    /**
     * @notice Helper function to estimate Project token amount for payment
     * @param projectID ID of the Project
     * @param amount Amount of payment tokens
     */
    function estimateProjectTokensById(
        string calldata projectID,
        uint256 amount
    )
        external
        view
        onlyValidProject(projectID)
        returns (uint256 projectTokenCount)
    {
        if(_projects[projectID].projectToken != address(0)){
            uint256 projectTokenDecimals = uint256(
                IERC20MetadataUpgradeable(_projects[projectID].projectToken)
                    .decimals()
            );
            projectTokenCount =
                (amount * 10**projectTokenDecimals) /
                _projects[projectID].tokenPrice;
        }    
    }

    /* View Functions end*/

    /* Investor */

    /**
     * @notice This method is used to invest in a publicly listed Project
     * @dev User must send msg.value equal to _amount in order to invest in BNB
     * @param projectID ID of the Project
     * @param _amount amount to be invested
     */
    function investFairLaunch(string calldata projectID, uint256 _amount)
        external
        payable
    {
        require(
            projectExist(projectID),
            "Launchpad: Project does not exist"
        );
        require(_amount != 0, "Launchpad: investment zero");

        Project memory project = _projects[projectID];
        require(
            block.timestamp >= project.projectOpenTime,
            "Launchpad: Project is not open"
        );
        require(
            block.timestamp < project.projectCloseTime,
            "Launchpad: Project has closed"
        );
        require(!project.cancelled, "Launchpad: Project cancelled");
        require(
            _amount >= project.minInvestmentAmount,
            "Launchpad: amount less than minimum investment"
        );
        ProjectInvestment storage projectInvestment = _projectInvestments[
            projectID
        ];

        require(
            project.targetAmount >= projectInvestment.totalInvestment + _amount,
            "Launchpad: amount exceeds target"
        );

        projectInvestment.totalInvestment += _amount;
        if (_projectInvestors[projectID][msg.sender].investment == 0)
            ++projectInvestment.totalInvestors;
        _projectInvestors[projectID][msg.sender].investment += _amount;

        if (project.paymentToken == address(0)) {
            require(
                msg.value == _amount,
                "Launchpad: msg.value not equal to amount"
            );
        } else {
            require(msg.value == 0, "Launchpad: msg.value not zero");
            IERC20Upgradeable(project.paymentToken).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }

        emit ProjectInvest(projectID, msg.sender, _amount);
    }

    /**
     * @notice This method is used to invest in a project with a presale round
     * @dev User must send msg.value equal to _amount in order to invest in BNB
     * @dev User must be whitelisted to invest when presale investment opens
     * @dev Whitelist status is only checked if the user tries to invest in presale time
     * @dev whitelisted user can also invest when public investment opens
     * @param projectID ID of the Project
     * @param merkleProof merkle path to verify selection
     * @param _amount amount to be invested
     */
    function investPresale(string calldata projectID, bytes32[] calldata merkleProof, uint256 _amount)
        external
        payable
    {
        require(
            projectExist(projectID),
            "Launchpad: Project does not exist"
        );
        require(_amount != 0, "Launchpad: investment zero");
        Project memory project = _projects[projectID];
        require(
            block.timestamp >= project.winnersOutTime,
            "Launchpad: Project is not open"
        );
        require(
            block.timestamp < project.projectCloseTime,
            "Launchpad: Project closed"
        );
        require(!project.cancelled, "Launchpad: Project cancelled");
        if(block.timestamp >= project.winnersOutTime && block.timestamp < project.projectOpenTime){
            require(
                _projectMerkleRoots[projectID] != bytes32(0),
                "Launchpad: whitelist not approved by admin yet"
            );
            require(
                _isWhitelisted(_projectMerkleRoots[projectID], merkleProof),
                "Launchpad: user is not whitelisted"
            );
            _presaleInvestments[projectID][msg.sender] += _amount;
        }
        else{
            _publicInvestments[projectID][msg.sender] += _amount;
        }
        require(
            _amount >= project.minInvestmentAmount,
            "Launchpad: amount less than minimum investment"
        );
        ProjectInvestment storage projectInvestment = _projectInvestments[
            projectID
        ];

        require(
            project.targetAmount >= projectInvestment.totalInvestment + _amount,
            "Launchpad: amount exceeds target"
        );

        projectInvestment.totalInvestment += _amount;
        if (_projectInvestors[projectID][msg.sender].investment == 0)
            ++projectInvestment.totalInvestors;
        _projectInvestors[projectID][msg.sender].investment += _amount;

        if (project.paymentToken == address(0)) {
            require(
                msg.value == _amount,
                "Launchpad: msg.value not equal to amount"
            );
        } else {
            require(msg.value == 0, "Launchpad: msg.value not zero");
            IERC20Upgradeable(project.paymentToken).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }
        emit ProjectInvest(projectID, msg.sender, _amount);
    }

    /**
     * @notice This method is used to refund investment if Project is cancelled
     * @param projectID ID of the Project
     */
    function refundInvestment(string calldata projectID)
        external
        onlyValidProject(projectID)
    {
        Project memory project = _projects[projectID];
        require(
            project.cancelled,
            "Launchpad: Project is not cancelled"
        );

        Investor memory user = _projectInvestors[projectID][msg.sender];
        require(!user.refunded, "Launchpad: already refunded");
        require(user.investment != 0, "Launchpad: no investment found");

        _projectInvestors[projectID][msg.sender].refunded = true;
        transferTokens(msg.sender, project.paymentToken, user.investment);

        emit ProjectInvestmentRefund(projectID, msg.sender, user.investment);
    }

    /**
     * @notice This method is used to claim investment if Project is closed
     * @param projectID ID of the Project
     */
    function claimIDOTokens(string calldata projectID)
        external
        onlyValidProject(projectID)
    {
        Project memory project = _projects[projectID];

        require(!project.cancelled, "Launchpad: Project is cancelled");
        require(
            block.timestamp > project.projectCloseTime,
            "Launchpad: Project not closed yet"
        );
        require(project.projectToken != address(0), "Launchpad: Project token not added yet");

        Investor memory user = _projectInvestors[projectID][msg.sender];
        require(!user.claimed, "Launchpad: already claimed");
        require(user.investment != 0, "Launchpad: no investment found");

        uint256 projectTokensPresale = estimateProjectTokens(
            project.projectToken,
            _presalePrices[projectID],
            _presaleInvestments[projectID][msg.sender]
        );
        uint256 projectTokensPublic = estimateProjectTokens(
            project.projectToken,
            project.tokenPrice,
            _publicInvestments[projectID][msg.sender]
        );
        uint256 projectTokens = projectTokensPresale + projectTokensPublic;
        _projectInvestors[projectID][msg.sender].claimed = true;
        _projectInvestments[projectID]
            .totalProjectTokensClaimed += projectTokens;

        IERC20Upgradeable(project.projectToken).safeTransfer(
            msg.sender,
            projectTokens
        );

        emit ProjectInvestmentClaim(projectID, msg.sender, projectTokens);
    }

    /* Investor Functions end*/

    /* Helper Functions */

    /** 
     * @notice This internal function is used to add an address as an admin
     * @dev Only the platform owner can call this function
     * @param role Role to be granted
     * @param newAdmin Address of the new admin
     */
    function _addAdmin(bytes32 role, address newAdmin) internal {
        require(
            newAdmin != address(0),
            "Launchpad: admin address zero"
        );
        _roles[role][newAdmin] = true;
        emit AddAdmin(newAdmin);
    }

    /** 
     * @notice This internal function is used to remove an admin
     * @dev Only the platform owner can call this function
     * @param role Role to be revoked
     * @param adminAddress Address of the admin
     */
    function _removeAdmin(bytes32 role, address adminAddress) internal {
        require(
            adminAddress != address(0),
            "Launchpad: admin address zero"
        );
        _roles[role][adminAddress] = false;
        emit RevokeAdmin(adminAddress);
    }

    /**
     * @notice Helper function to transfer tokens based on type
     * @param receiver Address of the receiver
     * @param paymentToken Address of the token to be transferred
     * @param amount Number of tokens to transfer
     */
    function transferTokens(
        address receiver,
        address paymentToken,
        uint256 amount
    ) internal {
        if (amount != 0) {
            if (paymentToken != address(0)) {
                IERC20Upgradeable(paymentToken).safeTransfer(receiver, amount);
            } else {
                (bool success, ) = payable(receiver).call{value: amount}("");
                if (!success) {
                    BNBFromFailedTransfers += amount;
                    emit TransferOfBNBFail(receiver, amount);
                }
            }
        }
    }

    /* Helper Functions end*/
}