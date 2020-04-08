const mongoose = require('mongoose')
const _ = require('lodash')

/*---------------------UTILITY FUNCTIONS------------------------*/
const getRandomThenRemove=(array)=>array.splice(_.random(array.length-1),1)[0]
const positionSchema = {
    type:[[Number]],
    default:[]
}
const getPositionSchema = ()=>({...positionSchema})
const getSchemaFromType = (type,def)=>({type,default:def})
const getTopHeadBottomHeadFromRoad = (road)=>_.chunk(road,6)

const compareDoubleArray = ([x1,y1],[x2,y2])=>x1===x2 && y1===y2

const comparePositions = (head1,head2)=>{
    const position1 = _.chunk(head1,2)
    const position2 = _.chunk(head2,2)
    for(let p of position2){
        let found = false
        for(let i = 0;i<position1.length;i++){
            if(compareDoubleArray(position1[i],p)){
                found = true
                position1.splice(i,1)
                break
            }
        }
        if(!found) return false
    }
    return true
}
const isThereThisPositionInThisArray = (position,array)=>{
    for(p of array){
        if(comparePositions(position,p)) return true
    }
    return false
}

/*-----------------------------------------------------------*/
/*The schemas for the different datas*/
/*Basically, there are 3 types:
+The player schema store info about what resources and settlements a player have
+The grid schema store the board. Basically: which tile contain which resources, where all the structures are, etc.
+The game schema combine the player and grid, plus a few other useful information for a game, like whether or
not a game is in progress, and the development card deck*/

const playerSchema = new mongoose.Schema({
    settlements:getPositionSchema(),
    cities:getPositionSchema(),
    roads:getPositionSchema(),

    developmentCards:getSchemaFromType([String],[]),
    //We have 2 development card deck in the player schema because 
    //we have to keep track of the card that had been used as well
    totalDevelopmentCards:getSchemaFromType([String],[]),

    //The amount of resources they have
    rockAmount:getSchemaFromType(Number,0),
    wheatAmount:getSchemaFromType(Number,0),
    sheepAmount:getSchemaFromType(Number,0),
    brickAmount:getSchemaFromType(Number,0),
    woodAmount:getSchemaFromType(Number,0),

    //When the player build a settlement near a port, we switched on these trading privelleges
    rockTrade:getSchemaFromType(Boolean,false),
    wheatTrade:getSchemaFromType(Boolean,false),
    sheepTrade:getSchemaFromType(Boolean,false),
    brickTrade:getSchemaFromType(Boolean,false),
    woodTrade:getSchemaFromType(Boolean,false),
    randomTrade:getSchemaFromType(Boolean,false),

    biggestArmy:getSchemaFromType(Boolean,false),
    longestRoad:getSchemaFromType(Boolean,false)
})

const gridSchema = new mongoose.Schema({
    resourceBoard:getSchemaFromType([[String]],[]),
    numberBoard:getPositionSchema(),
    structures:getPositionSchema(),
    settlements:getPositionSchema(),
    cities:getPositionSchema(),
    roads:getPositionSchema(),
    desertPosition:getSchemaFromType([Number],[]),
    robberPosition:getSchemaFromType([Number],[])
})

const gameSchema = new mongoose.Schema({
    grid: {
        type:gridSchema,
        required:true
    },
    players: {
        type:[playerSchema],
        required:true
    },
    //Game schema includes grids and a list of players
    //The username of the players is not included in the player schema because they can be used in many different games
    playerUsernames:getSchemaFromType([String],[]),
    developmentCardDeck:getSchemaFromType([String],[]),

    currentLongestRoadPlayer:getSchemaFromType(Number,-1),
    currentLargestArmyPlayer:getSchemaFromType(Number,-1),

    //Players will join online via a roomcode given to them by their friends
    //The roomcode is unique, and also is the socket room code
    roomCode:{...getSchemaFromType(String,''),unique:true},
    inGame:getSchemaFromType(Boolean,false),
    onTurn:getSchemaFromType(Number,-1)
})

const Player = mongoose.model('players',playerSchema)
const Grid = mongoose.model('grids',gridSchema)
const Game  = mongoose.model('games',gameSchema)

//TODO: Make the error handling a bit better
//This async wrapper make sure that whatever error is thrown is handled a little bit better
const asyncWrapper = (func)=>async function(){
    try{const result = await func(...arguments);
        return (result === undefined)?true:result}
    catch(e){console.log(e);return false;}
}

/* Functions relating to the player data */

const playerFunctionFactory = (func) => 
    asyncWrapper(async (game,playerId,otherArgument)=>{
        return await asyncWrapper(func)(game.players[playerId],game,otherArgument,playerId)
    })
    
//ABOVE: The reason we needed a function factory is because in a previous version of this backend, 
//all functions is called with the id of the game object only.
//Obviously, this mean that to get data from the game or change data, one have to fetch the game object
//from the database everytime a function is called, which is massively inefficient.
//So that had been fixed, now the game object is given directly. But this player function factory
//still remain because it would take too much time to remove it.

//BELOW: Most of these functions will not be called directly in our socket/controller. They will be called
//by functions in the game function section below, which will be called by our controller
//For example: the find point function will be called in the check win condition function.
//Details here: https://drive.google.com/a/sduhsd.net/file/d/1kQRi8capoak7-0EoLtPama4fO2MQUM-R/view?usp=drivesdk

//NOTE: to make it easy to discern, all functions that does not manipulate data just calculate things is prefixed with "FIND", 
//all functions that does manipulate data is prefixed with "DO"
//Ex: BELOW: findPoint does not manipulate data

//Calculate how many point a player have
const findPoint = playerFunctionFactory(async (player)=> 
    player.cities.length*2 + 
    player.settlements.length + 
    player.developmentCards.reduce((total,item)=>(item==='Point')?total+1:total,0) + 
    ((player.longestRoad)?2:0) + 
    ((player.biggestArmy)?2:0)
)

const findTotalKnight = playerFunctionFactory(async (player)=> 
player.totalDevelopmentCards.reduce((total,item)=>(item==='Knight')?total+1:total,0))

const findPossibleActions = playerFunctionFactory(async (player)=>{
    const result = []
    const {wheatAmount,brickAmount,sheepAmount,rockAmount,woodAmount} = player
    if(wheatAmount && sheepAmount && rockAmount) result.push("Development card")
    if(wheatAmount && sheepAmount && brickAmount && woodAmount) result.push("Settlement")
    if(brickAmount && woodAmount) result.push("Road")
    if(wheatAmount >= 2 && rockAmount >= 3) result.push("City")
    return result
})

const findTotalResources = playerFunctionFactory(async (player)=>{
    return player.wheatAmount + player.rockAmount + player.woodAmount + player.sheepAmount + player.brickAmount
})

//IMPORTANT: position format
//Position of a tile is given in the form of [y,x] 
//Position of an intersection (think settllement, cities) is given in [y1,x1,y2,x2,y3,x3]
//Position of 2 intersections (or heads) like a road who connect those two is in [y1,x1,y2,x2,y3,x3,y4,x4,y5,x5,y6,x6]

//TODO: make this less verbose
//The point of this function here is find the longest consecutive road length
const findLongestRoadLength = playerFunctionFactory(async (p)=>{
    const player = p.toObject()
    const findAllBranchesFromStartingPoint = (startingRoad)=>{
        const doesItConnect = (road1,road2)=>{
            const [firstTopHead,firstBottomHead] = getTopHeadBottomHeadFromRoad(road1)
            const [secondTopHead,secondBottomhead] = getTopHeadBottomHeadFromRoad(road2)
            return (comparePositions(secondTopHead,firstBottomHead) || comparePositions(secondBottomhead,firstTopHead) || comparePositions(secondBottomhead,firstBottomHead) || comparePositions(secondTopHead,firstTopHead))
            &&
            !((comparePositions(secondTopHead,firstTopHead) && comparePositions(secondBottomhead,firstBottomHead)) || (comparePositions(secondTopHead,firstBottomHead) && comparePositions(secondBottomhead,firstTopHead)))
        }
        
        const findAllPossibleConnectorToARoad = (road)=>{
            const connector = []
            player.roads.forEach(r=>{
                if(doesItConnect(r,road)) connector.push(r)
            })
            return connector
        }
        let branches = []
        const connectors = findAllPossibleConnectorToARoad(startingRoad)

        const addedTwiceAlready = (head,branch)=>{
            let count = 0
            for (const road of branch){
                const [topHead,bottomHead] = getTopHeadBottomHeadFromRoad(road)
                if(comparePositions(head,topHead) || comparePositions(head,bottomHead)) count++
                if(count===2) return true
            }
            return false
        }

        const recursivelyFindNewBranches = (currentMaster)=>{
            const latestBranch = currentMaster[currentMaster.length-1]
            const [branchTopHead,branchBottomHead] = getTopHeadBottomHeadFromRoad(latestBranch)
            const connectors = findAllPossibleConnectorToARoad(latestBranch).filter(e=>!currentMaster.includes(e)&&!addedTwiceAlready(branchTopHead,currentMaster)&&!addedTwiceAlready(branchBottomHead,currentMaster))
            if(connectors.length > 0){
                if(connectors.length > 1){
                    for(let i = 1;i<connectors.length;i++){
                        const newBranch = [...(currentMaster),connectors[i]]
                        branches.push(newBranch)
                        recursivelyFindNewBranches(newBranch)
                    }
                }
                currentMaster.push(connectors[0])
                recursivelyFindNewBranches(currentMaster)
            }
        }

        const recursivelyFindNewBranchesReverse = (currentMaster)=>{
            const latestBranch = currentMaster[0]
            const [branchTopHead,branchBottomHead] = getTopHeadBottomHeadFromRoad(latestBranch)
            const connectors = findAllPossibleConnectorToARoad(latestBranch).filter(e=>!currentMaster.includes(e)&&!addedTwiceAlready(branchTopHead,currentMaster)&&!addedTwiceAlready(branchBottomHead,currentMaster))
            if(connectors.length > 0){
                if(connectors.length > 1){
                    for(let i = 1;i<connectors.length;i++){
                        const newBranch = [connectors[i],...(currentMaster)]
                        branches.push(newBranch)
                        recursivelyFindNewBranchesReverse(newBranch)
                    }
                }
                currentMaster.unshift(connectors[0])
                recursivelyFindNewBranchesReverse(currentMaster)
            }
        }

        if(connectors.length > 0){
            let newMasterBranch = []
            if(connectors.length == 1){
                newMasterBranch = [startingRoad,connectors[0]]
                branches.push(newMasterBranch)
                recursivelyFindNewBranches(newMasterBranch)
            }
            else{
                newMasterBranch = [connectors[0],startingRoad,connectors[1]]
                const [startTopHead,startBottomHead] = getTopHeadBottomHeadFromRoad(startingRoad)
                if(addedTwiceAlready(startTopHead,newMasterBranch) || addedTwiceAlready(startBottomHead,newMasterBranch)){
                    newMasterBranch = [startingRoad,connectors[0]]
                    const otherMasterBranch = [startingRoad,connectors[1]]
                    recursivelyFindNewBranches(newMasterBranch)
                    recursivelyFindNewBranches(otherMasterBranch)
                    branches.push(otherMasterBranch)
                }
                else{
                    recursivelyFindNewBranchesReverse(newMasterBranch)
                    recursivelyFindNewBranches(newMasterBranch)
                }
                branches.push(newMasterBranch)
            }
        }
        else branches.push(startingRoad)
        return branches
    }

    const branches = [findAllBranchesFromStartingPoint(player.roads[0]),findAllBranchesFromStartingPoint(player.roads[1])]

    const lengthMap = branches.map(({length})=>length)
    return Math.max(...lengthMap)
})

const doChangePlayerResource = playerFunctionFactory(async (player,game,resourceChange)=>{
    const changePlayerResource = (player,resourceChange)=>{
        const {wheat,rock,brick,wood,sheep} = resourceChange
        player.wheatAmount += wheat || 0
        player.rockAmount += rock || 0
        player.brickAmount += brick || 0
        player.woodAmount += wood || 0
        player.sheepAmount += sheep || 0
    }

    changePlayerResource(player,resourceChange)
    await game.save()
})

const doNegativePlayerResource = playerFunctionFactory(async (player,game,resourceChange)=>{
    const changePlayerResource = (player,resourceChange)=>{
        const {wheat,rock,brick,wood,sheep} = resourceChange
        player.wheatAmount -= wheat || 0
        player.rockAmount -= rock || 0
        player.brickAmount -= brick || 0
        player.woodAmount -= wood || 0
        player.sheepAmount -= sheep || 0
    }

    changePlayerResource(player,resourceChange)
    await game.save()
})

const doBuyDevelopmentCardPlayer = playerFunctionFactory(async (player,game,card,playerid)=>{
    player.developmentCards.push(card)
    player.totalDevelopmentCards.push(card)
    await doChangePlayerResource(game,playerid,{wheat:-1,rock:-1,sheep:-1})
    await game.save()
})

const doUseDevelopmentCard = playerFunctionFactory(async (player,game,card)=>{
    if(player.developmentCards.indexOf(card)===-1) return false
    player.developmentCards.splice(player.developmentCards.indexOf(card),1)
    await game.save()
    return true
})

const doBuildSettlementPlayer = playerFunctionFactory(async (player,game,position,playerid)=>{
    player.settlements.push(position)
    await doChangePlayerResource(game,playerid,{wheat:-1,brick:-1,wood:-1,sheep:-1})
    await game.save()
})

const doBuildSettlementInitialPlayer = playerFunctionFactory(async (player,game,position)=>{
    player.settlements.push(position)
    await game.save()
})

const doBuildCityPlayer = playerFunctionFactory(async (player,game,position,playerid)=>{
    player.settlements = player.settlements.filter(pos=>!comparePositions(pos,position))
    player.cities.push(position)
    await doChangePlayerResource(game,playerid,{wheat:-2,rock:-3})
    await game.save()
})

const doBuildRoadPlayer = playerFunctionFactory(async (player,game,position,playerid)=>{
    player.roads.push(position)
    await doChangePlayerResource(game,playerid,{brick:-1,wood:-1})
    await game.save()
})

const doBuildRoadInitialPlayer = playerFunctionFactory(async (player,game,position)=>{
    player.roads.push(position)
    await game.save()
})

const canBuildSettlementPlayer = playerFunctionFactory(async (player)=>{
    return (player.wheatAmount && player.woodAmount && player.brickAmount && player.sheepAmount)
})

const canBuildCityPlayer = playerFunctionFactory(async (player)=>(player.wheatAmount >= 2 && player.rockAmount >= 3))

const canBuyDevelopmentCardPlayer = playerFunctionFactory(async (player)=>(player.sheepAmount && player.wheatAmount && player.rockAmount))

const canBuildRoadPlayer = playerFunctionFactory(async (player)=>(player.brickAmount && player.woodAmount))

/* FUNCTION FOR THE GRID CLASS */
//Grid has two boards: resource board and number boar
//Detail Structure: https://drive.google.com/a/sduhsd.net/file/d/1Hd-gH9Gzg-ytgbwdWGBz5NphaEggQxiK/view?usp=drivesdk

//TODO: find a better way to generate a board
const doCreateGrid = (()=>{
    const resourceTileReference = [
        "Desert",
        "Rock","Rock","Rock",
        "Brick","Brick","Brick",
        "Sheep","Sheep","Sheep","Sheep",
        "Wheat","Wheat","Wheat","Wheat",
        "Wood","Wood","Wood","Wood"
    ]

    const portTileReference =
    [
        "Rock trade","Brick trade","Sheep trade","Wheat trade","Wood trade",
        "Random trade","Random trade","Random trade","Random trade"
    ]

    const numberReference = [
        2,12,
        3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11
    ]

    const port = ()=>({resource:(getRandomThenRemove(portTileReference)),number:null})
    
    const sea = ()=>({resource:'Sea',number:null})

    const resource = ()=>{
        let type = getRandomThenRemove(resourceTileReference)
        let tile = (type==='Desert')?{resource:'Desert',number:null}:{resource:type,number:getRandomThenRemove(numberReference)}
        return tile
    }

    const masterBoard = [
                            [port(),sea(),port(),sea()],
                    [sea(),resource(),resource(),resource(),port()],
            [port(),resource(),resource(),resource(),resource(),sea()],
        [sea(),resource(),resource(),resource(),resource(),resource(),port()],
            [port(),resource(),resource(),resource(),resource(),sea()],
                    [sea(),resource(),resource(),resource(),port()],
                            [port(),sea(),port(),sea()]
    ]
    const resourceBoard = []
    const numberBoard = []
    let desert = []
    masterBoard.forEach((row,posY)=>{
        resourceBoard.push([])
        numberBoard.push([])
        row.forEach((tile,posX)=>{
            const {resource,number} = tile
            if(resource === 'Desert') desert = [posY,posX]
            resourceBoard[posY].push(resource)
            numberBoard[posY].push(number)
        })
    })
    
    const grid = new Grid({resourceBoard,numberBoard,desertPosition:desert,robberPosition:desert})
    return grid
})

//NOTE, below you will find a list of 
const gridFunctionFactory = (func)=>
    asyncWrapper(async (game,otherArgument)=>{
        return asyncWrapper(func)(game.grid,game,otherArgument)
    })

//BELOW: all possible intersections in a board.
const allGridLocation = [
    [0,0,1,0,1,1],[0,0,1,1,0,1],[0,1,1,1,1,2],[0,1,1,2,0,2],[0,2,1,2,1,3],[0,2,0,3,1,3],[0,3,1,3,1,4],
    [1,0,2,0,2,1],[1,0,2,1,1,1],[1,1,2,1,2,2],[1,1,2,2,1,2],[1,2,2,3,1,3],[1,2,2,2,2,3],[1,3,2,3,2,4],[1,3,1,4,2,4],[1,4,2,4,2,5],
    [2,0,3,0,3,1],[2,0,3,1,2,1],[2,1,3,1,3,2],[2,1,2,2,3,2],[2,2,3,2,3,3],[2,2,3,3,2,3],[2,3,3,3,3,4],[2,3,3,4,2,4],[2,4,3,4,3,5],[2,4,2,5,3,5],[2,5,3,5,3,6],
    [3,0,4,0,3,1],[3,1,4,0,4,1],[3,1,4,1,3,2],[3,2,4,2,3,3],[3,2,4,1,4,2],[3,3,4,2,4,3],[3,3,3,4,4,3],[3,4,4,3,4,4],[3,4,3,5,4,4],[3,5,4,4,4,5],[3,5,3,6,4,5],
    [4,0,5,0,4,1],[4,1,5,0,5,1],[4,1,4,2,5,1],[4,2,5,1,5,2],[4,2,5,2,4,3],[4,3,5,2,5,3],[4,3,4,4,5,3],[4,4,5,3,5,4],[4,4,4,5,5,4],
    [5,0,5,1,6,0],[5,1,6,0,6,1],[5,1,5,2,6,1],[5,2,6,1,6,2],[5,2,6,2,5,3],[5,3,6,2,6,3],[5,3,5,4,6,3]
]

const findPossibleInitialSettlementLocation = gridFunctionFactory(async (grid,game)=>{
    let possibles = allGridLocation
    grid.structures.forEach(position=>{
        possibles = possibles.filter(s=>!comparePositions(s,position))
    })
    return possibles
})

const findResourceFromDice = gridFunctionFactory(async (grid,game,diceNumber)=>{
    const positions = []
    for(y = 0;y<grid.numberBoard.length;y++){
        for(x=0;x<grid.numberBoard[y].length;x++){
            if(grid.numberBoard[y][x] === diceNumber){
                positions.push([y,x])
            }
        }
    }
    return positions.map(([y,x])=>[y,x,grid.resourceBoard[y][x]])
})

const doBuildSettlementGrid = gridFunctionFactory(async (grid,game,position)=>{
    grid.structures.push(position)
    grid.settlements.push(position)
    const tradingPrivillege = []
    const chunks = _.chunk(position,2)
    chunks.forEach(([y,x])=>{
        if(grid.resourceBoard[y][x].match(/trade/)) tradingPrivillege.push(grid.resourceBoard[y][x])
    })
    await game.save()
    return tradingPrivillege
})

const doBuildCityGrid = gridFunctionFactory(async (grid,game,position)=>{
    grid.structures = grid.structures.filter(e=>!comparePositions(e,position))
    grid.cities.push(position)
    await game.save()
})

const doBuildRoadGrid = gridFunctionFactory(async (grid,game,position)=>{
    grid.structures.push(position)
    grid.roads.push(position)
    await game.save()
})

const findAdjacentPositionsTo = gridFunctionFactory(async(grid,game,p)=>{
    const inBound = ([y,x])=>(y<grid.resourceBoard.length && y>=0 && x>=0 && x<grid.resourceBoard[y].length)
    const [[firstY],[secondY],[thirdY]] = _.chunk(p,2)
    const position = [..._.chunk(p,2)]
    let oddsOneOut
    if(firstY === secondY) oddsOneOut = position[2]
    else if (secondY === thirdY) oddsOneOut = position[0]
    else oddsOneOut = position[1]
    let tileRow = position.filter(tile=>tile!==oddsOneOut)
    tileRow = tileRow.sort(((a1,a2)=>a1[1]-a2[1]))
    const positionTypeCoefficient = oddsOneOut[0] - tileRow[0][0] 
    const [oddsY,oddsX] = oddsOneOut
    const leftOddsBorderTile = [oddsY,oddsX - 1]
    const rightOddsBorderTile = [oddsY,oddsX + 1]
    const result = []
    if(inBound(leftOddsBorderTile)) result.push([oddsOneOut,tileRow[0],leftOddsBorderTile])
    if(inBound(rightOddsBorderTile)) result.push([oddsOneOut,tileRow[1],rightOddsBorderTile])

    const yOfTileRowBorderTile = tileRow[0][0] - positionTypeCoefficient
    if(yOfTileRowBorderTile >= 0 && yOfTileRowBorderTile < grid.resourceBoard.length){
        const differenceInLength = grid.resourceBoard[tileRow[0][0]].length -  grid.resourceBoard[yOfTileRowBorderTile].length
        const tileRowBorderTile = [yOfTileRowBorderTile,tileRow[0][1] + ((differenceInLength < 0)?1:0)]
        if(inBound(tileRowBorderTile)) result.push([tileRowBorderTile,...tileRow])
    }
    
    return result.map((p)=>p.flat())
})
const thereIsAStructureAt = gridFunctionFactory(async (grid,game,p)=>{
    for(position of grid.structures){
        if(comparePositions(position,p)) return true
    }
    return false
})
const findValidPlacesToBuildAStructure = gridFunctionFactory(async (grid,game,position)=>{
    const adjacents = await findAdjacentPositionsTo(game,position)
    for(p of adjacents){
        const tf = await thereIsAStructureAt(game,p)
        if(tf) return false
    }
    return true
})
const findIfThereIsARoadAt = gridFunctionFactory(async (grid,game,position)=>{
    const compareRoad = (p1,p2)=>{
        const [topHeadOne,bottomHeadOne] = getTopHeadBottomHeadFromRoad(p1)
        const [topHeadTwo,bottomHeadTwo] = getTopHeadBottomHeadFromRoad(p2)
        return (comparePositions(topHeadOne,topHeadTwo) && comparePositions(bottomHeadOne,bottomHeadTwo)) || (comparePositions(topHeadTwo,bottomHeadOne) && comparePositions(bottomHeadTwo,topHeadOne))
    }
    for (road in grid.roads){
        if(compareRoad(road,position)) return true
    }   
    return false
})

const findRobberProspectiveLocations = gridFunctionFactory(async (grid)=>{
    const result = []
    for(let y = 0;y<grid.resourceBoard.length;y++){
        for(let x=0;x<grid.resourceBoard[y].length;x++){
            if(grid.resourceBoard[y][x] !== 'Desert' && grid.resourceBoard[y][x] === 'Sea' && grid.resourceBoard[y][x].match(/trade/) || [y,x] === grid.robberPosition) continue
            result.push([y,x])
        }
    }
    return result
})

const doMoveRobberTo = gridFunctionFactory(async (grid,game,[y,x])=>{
    if(! await findOutIfItIsAValidPlaceToMoveTheRobber(game,[y,x])) return false
    grid.robberPosition = [y,x]
    let playersRobbed = []
    BigLoop:for(let i = 0;i<game.players.length;i++){
        let player = game.players[i]
        for(let s of player.settlements){
            const positions = _.chunk(s,2)
            for(let p of positions){
                if(compareDoubleArray(p,[y,x])){
                    playersRobbed.push(i)
                    continue BigLoop
                }
            }
        }
        for(let s of player.cities){
            const positions = _.chunk(s,2)
            for(let p of positions){
                if(compareDoubleArray(p,[y,x])){
                    playersRobbed.push(i)
                    continue BigLoop
                }
            }
        }
    }
    return playersRobbed
})

const doCreateGame = asyncWrapper(async (roomCode)=>{
    const grid = await doCreateGrid()
    const developmentCardDeck = [
        ...Array(14).fill("Knight"),
        ...Array(5).fill("Point"),
        ...Array(2).fill("Monopoly"),
        ...Array(2).fill("Road"),
        ...Array(2).fill("Plenty")
    ]
    const game = new Game({grid,developmentCardDeck,roomCode})
    await game.save()
    return game
})

const findAllPossibleSettlementLocation = asyncWrapper(async (game,playerId)=>{
    let allRoadHeads = []
    game.players[playerId].roads.forEach((road)=>{
        const [topHead,bottomHead] = getTopHeadBottomHeadFromRoad(road)
        if(!isThereThisPositionInThisArray(topHead,allRoadHeads)) allRoadHeads.push(topHead)
        if(!isThereThisPositionInThisArray(bottomHead,allRoadHeads)) allRoadHeads.push(bottomHead)
    })
    allRoadHeads = await allRoadHeads.filter(async (head)=>{
        const structureAt = await thereIsAStructureAt(game,head)
        const structureAround = await findValidPlacesToBuildAStructure(game,head)
        if(structureAt) return false
        return (structureAround)
    })
    let i = 0
    while(i<allRoadHeads.length){
        const head = allRoadHeads[i]
        const structureAt = await thereIsAStructureAt(game,head)
        const structureAround = await findValidPlacesToBuildAStructure(game,head)
        if(structureAt||structureAround){
            allRoadHeads.splice(i,1)
        }
        else i++
    }

    return allRoadHeads
})

const doBuildSettlement = asyncWrapper(async (gameId,playerId,position)=>{
    let newPosition = [...position].flat()
    const allPossible = await findAllPossibleSettlementLocation(gameId,playerId)
    if(!isThereThisPositionInThisArray(newPosition,allPossible)) return false
    if(gameId.players[playerId].settlements.length === 5) return false
    const tf = await canBuildSettlementPlayer(gameId,playerId)
    if(!tf) return false
    await doBuildSettlementGrid(gameId,newPosition)
    await doBuildSettlementPlayer(gameId,playerId,newPosition)
    return position
})

const doBuildCity = asyncWrapper(async (gameId,playerId,position)=>{
    let newPosition = [...position].flat()
    if(!isThereThisPositionInThisArray(newPosition,gameId.players[playerId].settlements)) return
    if(gameId.players[playerId].cities.length ===4) return false
    const tf = await canBuildCityPlayer(gameId,playerId)
    if(!tf) return false
    await doBuildCityGrid(gameId,newPosition)
    await doBuildCityPlayer(gameId,playerId,newPosition)
    return position
})

const doBuildRoad = asyncWrapper(async (gameId,playerId,position)=>{
    let newPosition = [...position].flat(2)
    const possibles = await findAllPossibleRoadLocationFor(gameId,playerId)
    if(!isThereThisPositionInThisArray(newPosition,possibles)) return false
    if(gameId.players[playerId].roads.length === 14) return false
    const tf = await canBuildRoadPlayer(gameId,playerId)
    if(!tf) return false
    await doBuildRoadGrid(gameId,playerId,newPosition)
    await doBuildRoadPlayer(gameId,playerId,newPosition)
    return position
})

const doBuildSettlementInitial = asyncWrapper(async (game,playerid,position)=>{
    let newPosition = [...position].flat()
    const possibles = await findPossibleInitialSettlementLocation(game)
    if(!isThereThisPositionInThisArray(newPosition,possibles)) return false
    await doBuildSettlementInitialPlayer(game,playerid,newPosition)
    await doBuildSettlementGrid(game,newPosition)
    return position
})

const doBuildRoadInitial = asyncWrapper(async (game,playerid,settlementPosition,roadPosition)=>{
    let newSettlementPosition = [...settlementPosition].flat()
    let newRoadPosition = [...roadPosition].flat(2)
    const adjacents = await findAdjacentPositionsTo(game,newSettlementPosition)
    const [topHead,bottomHead] = getTopHeadBottomHeadFromRoad(newRoadPosition)
    if(!isThereThisPositionInThisArray(topHead,allGridLocation)) return false
    if(!isThereThisPositionInThisArray(bottomHead,allGridLocation)) return false
    if(!(comparePositions(topHead,newSettlementPosition) || comparePositions(bottomHead,newSettlementPosition))) return false
    if(comparePositions(topHead,newSettlementPosition) && !isThereThisPositionInThisArray(bottomHead,adjacents)) return false
    if(comparePositions(bottomHead,newSettlementPosition) && !isThereThisPositionInThisArray(topHead,adjacents)) return false
    await doBuildRoadInitialPlayer(game,playerid,newRoadPosition)
    await doBuildRoadGrid(game,newRoadPosition)
    return roadPosition
})

const doBuyDevelopmentCard = asyncWrapper(async (game,playerid)=>{
    if(game.developmentCardDeck.length === 0) return false
    const tf = await canBuyDevelopmentCardPlayer(game,playerid)
    if(!tf) return false
    const card = getRandomThenRemove(game.developmentCardDeck)
    await doBuyDevelopmentCardPlayer(game,playerid,card)
    await game.save()
    return card
})

const findAllPossibleRoadLocationFor = asyncWrapper(async (gameId,playerId)=>{
    const result = []
    const alreadyChecked = []
    const notAlreadyChecked = (head)=>{
        for(p in alreadyChecked){
            if(comparePositions(p,head)) return false
        }
        return true
    }
    const {players} = gameId
    const player = players[playerId]
    for (road of player.roads){
        const [topHead,bottomHead] = _.chunk(road,6)
        if(notAlreadyChecked(topHead)){
            const adjacent = await findAdjacentPositionsTo(gameId,topHead)
            for(position of adjacent){
                const tf = await findIfThereIsARoadAt(gameId,[...topHead,...position])
                if(!tf) result.push([...topHead,...position])
            }
            alreadyChecked.push(topHead)
        }
        if(notAlreadyChecked(bottomHead)){
            const adjacent = await findAdjacentPositionsTo(gameId,bottomHead)
            for(position of adjacent){
                const tf = await findIfThereIsARoadAt(gameId,[...bottomHead,...position])
                if(!tf) result.push([...bottomHead,...position])
            }
            alreadyChecked.push(bottomHead)
        }
    }
    return result
})

const findWinCondition = asyncWrapper(async (game)=>{
    const {players} = game
    const playerAmount = players.length
    let armySize = []
    let result = {}
    for(let i = 0;i<playerAmount;i++){
        const total = await findTotalKnight(game,i)
        armySize.push([total,i])
    }
    armySize = armySize.sort(([size1],[size2])=>size1-size2)
    players[armySize[0][1]].biggestArmy = true
    if(game.currentLargestArmyPlayer !== armySize[0][1]){
        game.currentLargestArmyPlayer = armySize[0][1]
        result.armyChange = armySize[0][1]
    }

    let roadLength = []
    for(let i = 0;i<playerAmount;i++){
        const total = await findLongestRoadLength(game,i)
        roadLength.push([total,i])
    }
    roadLength = roadLength.sort(([size1],[size2])=>size1-size2)
    players[roadLength[0][1]].longestRoad = true
    if(game.currentLongestRoadPlayer !== roadLength[0][1]){
        game.currentLongestRoadPlayer = roadLength[0][1]
        result.roadChange = roadLength[0][1]
    }
    await game.save()

    for(let i = 0;i<playerAmount;i++){
        if(findPoint(game,i) >= 10) return i
    }
    return result
})

const addPlayerToGame = asyncWrapper(async (game,username)=>{
    const player = new Player()
    const id = game.players.length
    game.players.push(player)
    game.playerUsernames.push(username)
    await game.save()
    return id
})

const doDiceRoll = asyncWrapper(async (game,roll)=>{
    const resources = await findResourceFromDice(game,roll)
    const addResource = (resource,amount,player)=>{
        if(resource === 'Wheat') player.wheatAmount+=amount
        if(resource === 'Sheep') player.sheepAmount+=amount
        if(resource === 'Rock') player.rockAmount+=amount
        if(resource === 'Wood') player.woodAmount+=amount
        if(resource === 'Brick') player.brickAmount+=amount
    }

    resources.forEach(([y,x,resources])=>{
        if(([y,x])!==game.grid.robberPosition){
            game.players.forEach((player)=>{
                player.cities.forEach(position=>{
                    if(position[0] === [y,x] || position[1] === [y,x] || position[2] === [y,x]){
                        addResource(resources,2,player)
                    }
                })
                player.settlements.forEach(position=>{
                    if(position[0] === [y,x] || position[1] === [y,x] || position[2] === [y,x]){
                        addResource(resources,1,player)
                    }
                })
            })
        }
    })
    await game.save()
})
//TODO: FIX WORLD GENERATING
const doUseMonopolyCard = asyncWrapper(async (game,playerid,resource)=>{
    let totalResourceChange = 0
    const resourceName = resource.toLowerCase() + 'Amount'
    game.players.forEach((player,index)=>{
        if(index !== playerid){
            const number = player[resourceName]
            player[resourceName] = 0
            totalResourceChange+=number
        }
    })
    game.players[playerid][resourceName] += totalResourceChange
    await game.save()
})

const findOutIfItIsAValidPlaceToMoveTheRobber = asyncWrapper(async (game,position)=>{
    const possibles = await findRobberProspectiveLocations(game)
    for(let p of possibles){
        if(compareDoubleArray(p,position)) return true
    }
    return false
})

const passTurn = asyncWrapper(async (game)=>{
    if(game.onTurn === game.players.length-1) game.onTurn = 0
    else game.onTurn++
    await game.save()
})

const findRobbedByRobber = asyncWrapper(async (game)=>{
    let players = game.playerUsernames.map((e,i)=>i)

    let resources = []
    for(let p of players){
        resources.push(await findTotalResources(game,p))
    }

    let result = []
    for(let i = 0;i<players.length;i++){
        if(resources[i]>7) result.push(players[i])
    }
    return result
})

const doStealFromAnotherPerson = asyncWrapper(async (game,stealer,stolener)=>{
    let availibleResources = ['wheatAmount','rockAmount','sheepAmount','woodAmount','brickAmount']
    availibleResources.filter(e=>game.players[stolener][e])
    if(availibleResources.length === 0) return ''
    let resource = availibleResources[_.random(availibleResources.length-1)]
    game.players[stealer][resource]++
    game.players[stolener][resource]--
    await game.save()
    return resource
})

module.exports = {doNegativePlayerResource,doStealFromAnotherPerson,doDiceRoll,findRobbedByRobber,passTurn,doBuildRoadInitial, doBuildSettlementInitial,addPlayerToGame,playerSchema,gridSchema,gameSchema,Player,Grid,Game,findPoint,findTotalKnight,findPossibleActions,findLongestRoadLength,doBuyDevelopmentCard,doUseDevelopmentCard
,doBuildSettlementPlayer,doBuildCityPlayer,doBuildRoadPlayer,canBuildSettlementPlayer,canBuildRoadPlayer,doCreateGrid,allGridLocation,findPossibleInitialSettlementLocation,findResourceFromDice,doBuildSettlementGrid,
doBuildCityGrid,doBuildRoadGrid,findAdjacentPositionsTo,thereIsAStructureAt,findValidPlacesToBuildAStructure,findIfThereIsARoadAt,findRobberProspectiveLocations,doMoveRobberTo,doCreateGame,doBuildSettlement,doBuildCity,
doBuildRoad,findAllPossibleRoadLocationFor,findWinCondition,doChangePlayerResource,canBuyDevelopmentCardPlayer,doUseMonopolyCard,findOutIfItIsAValidPlaceToMoveTheRobber}