const _ = require('lodash')
const {Board,Grid,Player,Storage,Deck,Road} = require('./model')

const getRandomThenRemove = (array)=>array.splice(_.random(array.length-1),1)[0]

class Storage{
    constructor({wheat,brick,rock,sheep,wood} = {}){
        this.wheat = wheat || 0
        this.brick = brick || 0
        this.rock = rock || 0
        this.sheep = sheep || 0
        this.wood = wood || 0
    }

    addResources({wheat,brick,rock,sheep,wood} = {}){
        this.wheat += wheat || 0
        this.brick += brick || 0
        this.rock += rock || 0
        this.sheep += sheep || 0
        this.wood += wood || 0
    }

    removeFromStorage({wheat,brick,rock,sheep,wood} = {}){
        this.wheat -= wheat || 0
        this.brick -= brick || 0
        this.rock -= rock || 0
        this.sheep -= sheep || 0
        this.wood -= wood || 0
    }

    doubleCurrentResources(){
        this.wheat*=2
        this.brick*=2
        this.rock*=2
        this.sheep*=2
        this.wood*=2
    }
}

class Deck{
    constructor(){
        this.deck = [
            ...Array(14).fill("Knight"),
            ...Array(5).fill("Point"),
            ...Array(2).fill("Monopoly"),
            ...Array(2).fill("Road"),
            ...Array(2).fill("Plenty")
        ]
    }

    draw(){
        return getRandomThenRemove(this.deck)
    }
}

class Player{
    constructor(){
        this.settlements = []
        this.city = []
        this.roads = []
        this.developmentCards = []
        this.totalDevelopmentCards = []

        this.resources = new Storage()
        this.tradingPrivillege = {
            rock:false,
            wheat:false,
            sheep:false,
            brick:false,
            wood:false,
            random:false
        }

        this.longestRoad = false
        this.biggestArmy = false
    }

    get point(){
        return this.city.length*2 + this.settlements.length + 
        this.developmentCards.reduce((total,item)=>{
            if(item==="Point") total++
        },0) + ((this.longestRoad)?2:0) + ((this.biggestArmy)?2:0)
    }

    get totalKnight(){
        return this.developmentCards.reduce((total,item)=>{
            if(item==='Knight') total++
        })
    }

    get possibleActions(){
        const result = []
        const {wheat,brick,rock,wood,sheep} = this.resources
        if(wheat && sheep && rock) result.push("development card")
        if(wheat && sheep && brick && wood) result.push("settlement")
        if(brick && wood) result.push("road")
        if(wheat >= 2 && rock >= 3) result.push("city")
        return result
    }

    buyDevelopmentCard(card){
        this.developmentCards.push(card)
        this.totalDevelopmentCards.push(card)
        this.resources.removeFromStorage({wheat:1,sheep:1,rock:1})
    }

    useDevelopmentCard(card){
        this.developmentCards.splice(this.developmentCards.indexOf(card),1)
    }

    buildSettlement(settlement){
        this.settlements.push(settlement)
        this.resources.removeFromStorage({wheat:1,brick:1,wood:1,sheep:1})
    }

    buildCity(city){
        this.settlements = this.settlements.filter(s=>s.position!==city.position)
        this.city.push(city)
        this.resources.removeFromStorage({wheat:2,rock:3})
    }

    buildRoad(road){
        this.roads.push(road)
        this.resources.removeFromStorage({brick:1,wood:1})
    }

    get canBuildSettlement(){
        const {wheat,sheep,brick,wood} = this.resources
        return wheat&&sheep&&brick&&wood
    }

    get canBuildCity(){
        const {wheat,rock} = this.resources
        return (wheat>=2&&rock>=3)
    }

    get canBuildRoad(){
        const {brick,wood} = this.resources
        return brick&&wood
    }

    get canBuyDevelopmentCard(){
        const {sheep,rock,wheat} = this.resources
        return sheep&&rock&&wheat
    }

    get armySize(){
        let count = 0
        this.totalDevelopmentCards.forEach(
            e=>count+=(e==="Knight")?1:0
        )
        return count
    }

    get longestRoadLength(){
        //The idea here is that wherever that longest road go, it had to connect to one of the two intital settlements. 
        const findAllBranchesFromStartingPoint = (startingRoad)=>{
            const findAllPossibleConnectorToARoad = (road)=>{
                const connector = []
                this.roads.forEach(r=>{
                    if(r.doesItConnect(road)) connector.push(r)
                })
                return connector
            }
            let branches = []
            const connectors = findAllPossibleConnectorToARoad(startingRoad)

            const addedTwiceAlready = (head,branch)=>{
                let count = 0
                for (const {topHead,bottomHead} of branch){
                    if(topHead === head || bottomHead === head) count++
                    if(count===2) return true
                }
                return false
            }

            const recursivelyFindNewBranches = (currentMaster)=>{
                const latestBranch = currentMaster[currentMaster.length-1]
                const connectors = findAllPossibleConnectorToARoad(latestBranch).filter(e=>!currentMaster.includes(e)&&!addedTwiceAlready(e.topHead,currentMaster)&&!addedTwiceAlready(e.bottomHead,currentMaster))
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
                const connectors = findAllPossibleConnectorToARoad(latestBranch).filter(e=>!currentMaster.includes(e)&&!addedTwiceAlready(e.topHead,currentMaster)&&!addedTwiceAlready(e.bottomHead,currentMaster))
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
                    if(addedTwiceAlready(startingRoad.topHead,newMasterBranch) || addedTwiceAlready(startingRoad.bottomHead,newMasterBranch)){
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
            return branches
        }

        const branches = [...findAllBranchesFromStartingPoint(this.roads[0]),...findAllBranchesFromStartingPoint(this.roads[1])]

        const lengthMap = branches.map(({length})=>length)
        return Math.max(...lengthMap)
    }
}

class Board{
    constructor(){
        this.tiles = []
        this.seaTiles = []
        this.portTiles = []
        this.resourceTiles = []
        this.desertTile = undefined

        const resourceTileReference = [
            "desert",
            "rock","rock","rock",
            "brick","brick","brick",
            "sheep","sheep","sheep","sheep",
            "wheat","wheat","wheat","wheat",
            "wood","wood","wood","wood"
        ]

        const portTileReference =
        [
            "rock","brick","sheep","wheat","wood",
            "random","random","random","random"
        ]

        const numberReference = [
            2,12,
            3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11
        ]

        const port = ()=>{
            let tile = new PortTile(getRandomThenRemove(portTileReference))
            this.tiles.push(tile)
            this.portTiles.push(tile)
            return tile
        }

        const sea = ()=>{
            let tile = new SeaTile()
            this.tiles.push(tile)
            this.seaTiles.push(tile)
            return tile
        }

        const resource = ()=>{
            let type = getRandomThenRemove(resourceTileReference)
            let tile = (type==='desert')?new DesertTile():new ResourceTile(type,getRandomThenRemove(numberReference))
            this.tiles.push(tile)
            if(type==='desert') this.desertTile = tile;
            else this.resourceTiles.push(tile);
            return tile
        }

        this.board = [
                                [port(),sea(),port(),sea()],
                        [sea(),resource(),resource(),resource(),port()],
                [port(),resource(),resource(),resource(),resource(),sea()],
            [sea(),resource(),resource(),resource(),resource(),resource(),sea()],
                [port(),resource(),resource(),resource(),resource(),sea()],
                        [sea(),resource(),resource(),resource(),port()],
                                [port(),sea(),port(),sea()]
        ]
    }

    getResourceFromPosition(position){
        let resource = []
        let number = []
        let tradingPrivillege = []
        position.forEach(([y,x])=>{
            if(this.board[y][x].kind === 'resource'){
                resource.push(this.board[y][x].resource)
                number.push(this.board[y][x].number)
            }
            if(this.board[y][x].kind ==='port'){
                tradingPrivillege.push(this.board[y][x].tradingType)
            }
        })
        return {resource,number,tradingPrivillege}
    }
}

class Grid{
    constructor(board){
        this.structures = []
        this.settlements = []
        this.cities = []
        this.roads = []
        this.board = board.board
        this.boardClass = board
    }

    findAllGridLocation(){
        let result = []
        for(let i = 0;i<this.board.length-1;i++){
            for(let a = 0;a<this.board[i].length;a++){
                if(!this.board[i+1][a+1]){
                    if(this.board[i][a+1]) result.push([[i,a],[i+1,a],[i,a+1]])
                    continue
                }
                if(this.board[i+1][a]) result.push([[i,a],[i+1,a],[i+1,a+1]])
                if(this.board[i][a+1]) result.push([[i,a],[i+1,a+1],[i,a+1]])
            }
        }
        return result
    }

    findPossibleInitialSettlementLocation(){
        let possibles = this.findAllGridLocation()
        this.structures.forEach(({position})=>{
            possibles = possibles.filter((s)=>s!==position)
        })
        return possibles
    }

    checkIfSettlementGetAnyResources(diceNumber){
        this.settlements.forEach(s=>{
            s.player.resources.addResources(s.checkIfSettlementGetAnyResources(diceNumber))
        })

        this.cities.forEach(s=>{
            s.player.resources.addResources(s.checkIfSettlementGetAnyResources(diceNumber))
        })
    }

    buildSettlement(player,position){
        const {resource,number,tradingPrivillege} = this.boardClass.getResourceFromPosition(position)
        tradingPrivillege.forEach(e=>player.tradingPrivillege[e] = true)
        const settlement = new Settlement(player,position,resource,number)
        this.structures.push(settlement)
        this.settlements.push(settlement)
        return settlement
    }
    
    buildCity(player,position){
        const oldSettlement = this.settlements.find(e=>e.position === position)
        const city = new City(player,position,oldSettlement.resources,oldSettlement.number)
        this.structures = this.structures.filter(e=>e!==oldSettlement)
        this.settlements = this.settlements.filter(e=>e!==oldSettlement)
        this.cities.push(city)
        return city
    }

    buildRoad(player,topHead,bottomHead){
        const road = new Road(player,topHead,bottomHead)
        this.structures.push(road)
        this.roads.push(road)
        return road
    }

    thereIsAStructureAt(p){
        return this.structures.find(({position})=>position===p)
    }

    validPlaceToBuildAStructure(position){
        const adjacents = this.findAdjacentPositionsTo(position)
        for(p of adjacents){
            if(this.thereIsAStructureAt(p)) return false
        }
        return true
    }

    findAdjacentPositionsTo(position){
        //The idea behind this function is this:
        //What ever the intersection is, it is always in the shape of either a MickeyMouse face or a spaceship
        //The idea behind this function is this: find the surrounding tile to make it a bigger MickeyMouse face/spaceship
        //To do that, we find the odds on out and the tile row. Odds one out has a different y value then the 2 on the tile row
        //After than, add 1 and decrease 1 to the odds one out to find the other 2 tiles
        //Finally, use the tile row to find the tile bordering both of them. Note that we have to adjust the length to fit the different length of the 
        //rows
        const inBound = ([y,x])=>(y<this.board.length && y>=0 && x>=0 && x<this.board[y].length)

        const [[firstY],[secondY],[thirdY]] = position
        const oddsOneOut = (firstY === secondY) ? position[2] : ((secondY===thirdY)? position[0]:position[1])
        const tileRow = position.filter(tile=>tile!==oddsOneOut)
        tileRow.sort(([y1,x1],[y2,x2])=>x1-x2)
        const positionTypeCoefficient = oddsOneOut[0] - tileRow[0][0] 
        const [oddsY,oddsX] = oddsOneOut
        const leftOddsBorderTile = [oddsY,oddsX - 1]
        const rightOddsBorderTile = [oddsY,oddsX + 1]
        const result = []
        if(inBound(leftOddsBorderTile)) result.push([oddsOneOut,tileRow[0],leftOddsBorderTile])
        if(inBound(rightOddsBorderTile)) result.push([oddsOneOut,tileRow[1],rightOddsBorderTile])

        const yOfTileRowBorderTile = tileRow[0][0] - positionTypeCoefficient
        if(yOfTileRowBorderTile >= 0 && yOfTileRowBorderTile < this.board.length){
            const differenceInLength = this.board[tileRow[0][0]].length -  this.board[yOfTileRowBorderTile].length
            const tileRowBorderTile = [yOfTileRowBorderTile,tileRow[0][1] + ((differenceInLength < 0)?1:0)]
            if(inBound(tileRowBorderTile)) result.push([tileRowBorderTile,...tileRow])
        }
        
        return result
    }

    isThereARoadWithTheseHeads(bottomHead,topHead){
        for(road of this.roads){
            if(road.isItMe(bottomHead,topHead)) return true
        }
        return false
    }

    get robberProspectiveLocation(){
        const result = []
        for(var y = 0; y<this.board.length;y++){
            for(var x = 0;x<this.board[y].length;x++){
                if((this.board[y][x].kind !== "desert" && this.board[y][x].kind !== "resource") || this.robber) continue
                result.push([y,x])
            }
        }
        return result
    }

    get currentRobberTile(){
        if(this.boardClass.desertTile.robber) return this.boardClass.desertTile
        else return this.boardClass.resourceTiles.find(({robber})=>robber)
    }
}

class Settlement{
    constructor(player,position,resources,number){
        this.player = player
        this.position = position
        this.resources = resources
        this.number = number
    }

    checkIfSettlementGetAnyResources(diceNumber){
        const resources = new Storage()
        this.number.forEach((number,index)=>{
            if(number===diceNumber) resources[this.resources[index]]++
        })
        return resources
    }
}

class City extends Settlement{
    checkIfSettlementGetAnyResources(diceNumber){
        return suepr(diceNumber).doubleCurrentResources()
    }
}

class Road{
    constructor(player,topHead,bottomHead){
        this.player = player
        this.topHead = topHead
        this.bottomHead = bottomHead
    }

    doesItConnect({topHead,bottomHead}){
        return (topHead == this.bottomHead || bottomHead == this.topHead || bottomHead == this.bottomHead || topHead == this.topHead)
        &&
        !((topHead==this.topHead && bottomHead==this.bottomHead) || (this.bottomHead == topHead && this.topHead == bottomHead))
    }

    isItMe(topHead,bottomHead){
        return (topHead == this.topHead && bottomHead == this.bottomHead) || (topHead == this.bottomHead && bottomHead == this.topHead)
    }
}

class Tile{
    constructor(){
        this.kind = "undefined"
    }
}

class SeaTile extends Tile{
    constructor(){
    super()        
        this.kind = "sea"
    }
}

class PortTile extends Tile{
    constructor(resource){
        super()
        this.kind = "port"
        this.tradingType = resource
    }
}

class ResourceTile extends Tile{
    constructor(resource,number){
        super()
        this.kind = "resource"
        this.number = number
        this.resource = resource
        this.robber = false
    }
}

class DesertTile extends Tile{
    constructor(){
        super()
        this.kind = "desert"
        this.robber = true
    }
}

class Game{
    constructor(){
        console.log("Hello world")
        this.board = new Board()
        this.grid = new Grid(this.board)
        this.players = Array(4).fill(new Player())
        this.developmentCardDeck = new Deck()
        const player = new Player()
        this.currentLongestRoadPlayer = null
        this.currentLargestArmyPlayer = null
    }

    buildSettlement(player,position){
        if(!player.canBuildSettlement) return
        player.buildSettlement(this.grid.buildSettlement(player,position))
    }

    buildCity(player,position){
        if(!player.canBuildCity) return
        player.buildCity(this.grid.buildCity(player,position))
    }

    buyDevelopmentCard(player){
        if(!player.canBuyDevelopmentCard) return
        return player.buyDevelopmentCard(this.developmentCardDeck.draw())
    }

    buildRoad(player,topHead,bottomHead){
        if(!player.canBuildRoad) return
        player.buildRoad(this.grid.buildRoad(player,topHead,bottomHead))
    }

    findAllPossibleRoadLocationFor(player){
        const result = []
        const alreadyChecked = []
        const notAlreadyChecked = (head)=>!alreadyChecked.includes(head)
        player.roads.forEach(({topHead,bottomHead})=>{
            if(notAlreadyChecked(topHead)){
                const adjacent = this.grid.findAdjacentPositionsTo(topHead)
                adjacent.forEach(position=>{
                    if(!this.grid.isThereARoadWithTheseHeads(topHead,position)) result.push([topHead,position])
                })
                alreadyChecked.push(topHead)
            }
            if(notAlreadyChecked(bottomHead)){
                const adjacent = this.grid.findAdjacentPositionsTo(bottomHead)
                adjacent.forEach(position=>{
                    if(!this.grid.isThereARoadWithTheseHeads(bottomHead,position)) result.push([bottomHead,position])
                })
                alreadyChecked.push(bottomHead)
            }
        })
        return result
    }

    diceRoll(number){
        if(number === 7) return
        this.grid.checkIfSettlementGetAnyResources(number)
    }

    get robberPossibleLocations(){
        return this.grid.robberProspectiveLocation()
    }

    moveRobberTo([y,x]){
        this.grid.currentRobberTile.robber = false
        this.grid.board[y][x].robber = true
    }

    checkWinCondition(){
        let armySize = this.players.map((player)=>[player.totalKnight,player])
        armySize = armySize.sort(([size1],[size2])=>size1-size2)
        if(this.currentLargestArmyPlayer) this.currentLargestArmyPlayer.biggestArmy = false 
        armySize[0][1].biggestArmy = true
        this.currentLargestArmyPlayer = armySize[0][1]

        let roadLength = this.players.map((player)=>[player.longestRoadLength,player])
        roadLength = roadLength.sort(([length1],[length2])=>length1-length2)
        if(this.currentLongestRoadPlayer) this.currentLongestRoadPlayer.longestRoad = false
        roadLength[0][1].longestRoad = true
        this.currentLongestRoadPlayer = roadLength[0][1]

        for(let player of this.players){
            if(player.point >= 10) return player
        }
        return false
    }
}

module.exports = Game