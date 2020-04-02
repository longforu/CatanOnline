const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const {addPlayerToGame,playerSchema,gridSchema,gameSchema,Player,Grid,Game,findPoint,findTotalKnight,findPossibleActions,findLongestRoadLength,doBuyDevelopmentCard,doUseDevelopmentCard
    ,doBuildSettlementPlayer,doBuildCityPlayer,doBuildRoadPlayer,canBuildSettlementPlayer,canBuildRoadPlayer,doCreateGrid,findAllGridLocation,findPossibleInitialSettlementLocation,findResourceFromDice,doBuildSettlementGrid,
    doBuildCityGrid,doBuildRoadGrid,findAdjacentPositionsTo,thereIsAStructureAt,findValidPlacesToBuildAStructure,findIfThereIsARoadAt,findRobberProspectiveLocations,doMoveRobberTo,doCreateGame,doBuildSettlement,doBuildCity,
    doBuildRoad,findAllPossibleRoadLocationFor,findWinCondition,doChangePlayerResource,canBuyDevelopmentCardPlayer,doUseMonopolyCard} = require('./Model/model')
const _ = require('lodash')

//Todo list for today:
//+Set up the socket system for robber handling
//+Set up the socket system for initial settlement
//+Finish the socket system
//+Reevaluate how much time is left, then work on the front end with a new todo list

module.exports = (io)=>{

    const socketMap = new Map()
    const timerMap = new Map()
    const turnSpecificInfo = new Map()

    io.on('connect',async (socket)=>{

        const emit = (message,arg)=>io.to(socket.roomCode).emit(message,arg)
        const emitWithoutSelf = (message,arg)=>socket.to(socket.roomCode).emit(message,arg)

        const resetTurnSpecificInfo = ()=>{
            turnSpecificInfo.set(socket.roomCode,{
                boughtDevelopmentCard:false,
                usedDevelopmentCard:false,
                state:'normal',
                //if the state is waiting, every other event will be disabled except for the 
                //event that it is waiting for
                waitingFor:''
            })
        }

        const changeStateToWaitingFor = (waitingFor)=>{
            setTurnSpecificInfo('state','waiting')
            setTurnSpecificInfo('waitingFor',waitingFor)
        }

        const revertToNormalState = ()=>{
            setTurnSpecificInfo('state','normal')
            setTurnSpecificInfo('waitingFor',null)
        }

        const setTurnSpecificInfo = (property,value)=>{
            const newObject = {...turnSpecificInfo.get(socket.roomCode)}
            newObject[property] = value
            turnSpecificInfo.set(socket.roomCode,newObject)
        }

        const getTurnSpecificInfo = (property)=>turnSpecificInfo.get(socket.roomCode)[property]

        const socketError = (error)=>{
            const {message} = error
            console.log(error)
            socket.emit('Error',{message})
        }
        const asyncSocketWrap = (func)=>async (...args)=>{
            try{return await func(...args);} catch({message}){return socketError(message);}
        }

        const socketFunctionFactory = (func)=>asyncSocketWrap(async(...args)=>{
            return await func(...args)
        })

        const startTurnTimer = ()=>{
            cancelTurnTimer()
            timerMap.set(socket.roomCode,setTimeout(()=>{
                socket.emit("Start turn timer")
                socket.turnTimer = setTimeout(()=>{
                    passTurn()
                })
            },30000))
        }
        
        const cancelTurnTimer = ()=>{
            socket.emit("Cancel turn timer")
            clearTimeout(timerMap.get(socket.roomCode))
            timerMap.set(socket.roomCode,null)
        }

        const startGame = socketFunctionFactory(async (game)=>{
            //Still have to check in game because multiple messages may be sending at the same time
            if(!game.inGame){
                game.inGame = true
                await game.save()
                io.to(game.roomCode).emit("Game starting")
                
                passTurn(game)
            }
        })

        const robberNeeded = ()=>{

        }

        const passTurn = async ()=>{
            cancelTurnTimer()
            resetTurnSpecificInfo()
            //Check if someone had win the game after every turn
            const win = await findWinCondition(socket.game)
            if(win !== false) return endGame(socket.game,win)

            //Roll the dice, change the resource on the model then send that dice to the client for displaying
            const dice = _.random(10)+2
            const turn = (socket.game.onTurn + 1 === socket.game.players.length)?0:socket.game.onTurn+1
            socket.game.onTurn = turn
            await socket.game.save()
            io.to(socket.game.roomCode).emit("Dice result",{dice})

            if(dice === 7){
                robberNeeded(socket.game,turn)
            }
            else{
                await doDiceRoll(socket.game,dice)
                emit("Action needed",{turn})
                startTurnTimer()
            }
        }

        //Intiating the socket for use
        const {roomCode,userid} = jwt.verify(socket.handshake.query.token,process.env.SECRET_KEY)
        if(!id || !roomCode){
            socketError("Credential is invalid")
            socket.disconnect()
        }
        socket.roomCode = roomCode
        socket.userid = userid
        socket.game = await Game.findOne({roomCode})
        socket.user = socket.game.players[socket.userid]
        socket.username = socket.game.playerUsernames[socket.userid]
        socket.join(socket.roomCode)
        socket.to(socket.roomCode).emit("New player",{username:socket.playerUsernames})
        const gameData = socket.game.toObject()
        socket.emit("Game data",{gameData})
        if(!socketMap.has(socket.roomCode)){
            socketMap.set(socket.roomCode,[])
        }
        socketMap.set(socket.roomCode,[...socketMap.get(socket.roomCode),socket.id])
        if(socket.game.players.length === 4) startGame(socket.game)
        //Initiation ended

        const userActionFunctionFactory = (func)=>asyncSocketWrap(async (...args)=>{
            if(!socket.game.inGame) throw Error("The game had ended")
            if(socket.userid !== socket.game.onTurn) throw Error("Not your turn")
            if(getTurnSpecificInfo('state') === 'waiting') throw Error("Cannot complete action at this time")
            startTurnTimer()
            await func(...args)
        })

        //Events
        socket.on("Start game",asyncSocketWrap(()=>startGame(socket.game)))
        socket.on("Pass turn",userActionFunctionFactory(()=>{
            cancelTurnTimer()
            passTurn()
        }))
        socket.on("Trade Initiation",userActionFunctionFactory(({players,resource})=>{
            emitWithoutSelf("Trade Initiation",{players,resource})
        }))
        socket.on("Trade Acceptance",userActionFunctionFactory(async ({players,resource})=>{
            const player2 = players
            const [resource1,resource2] = resource
            await doChangePlayerResource(socket.game,socket.userid,resource1)
            await doChangePlayerResource(socket.game,player2,resource2)
            emitWithoutSelf("Trade Acceptance",players,resource)
        }))
        socket.on("Trade with Bank",userActionFunctionFactory(async ({resource})=>{
            const [give,take] = resource
            let eligibleResources = 0
            const negativeGive = {...give}
            for (let resource in give){
                let defaultRate = 4
                if(socket.user.randomTrade) defaultRate = 3
                if(socket.user[resource+"Trade"]) defaultRate = 2
                if(give[resource] % defaultRate !== 0) throw Error("Invalid Trade")
                else eligibleResources += give[resource]/defaultRate
                negativeGive[resource] = - negativeGive[resource]
            }
            let totalTake = 0
            for(let resource in take){
                totalTake += take[resource]
            }

            if(eligibleResources !== totalTake) throw Error("Invalid Trade")
            await doChangePlayerResource(socket.game,socket.userId,take)
            await doChangePlayerResource(socket.game,socket.userId,negativeGive)
            emitWithoutSelf("Trade with Bank",{resource})
        }))
        const actionErrorMessage = "Do not have enough resources to complete that action"

        socket.on("Buy development card",userActionFunctionFactory(async ()=>{
            if(getTurnSpecificInfo('boughtDevelopmentCard')) return
            else setTurnSpecificInfo('boughtDevelopmentCard',true)
            const card = await doBuyDevelopmentCard(socket.game,socket.userid)
            if(!card) throw Error(actionErrorMessage)
            socket.emit("Buy development card",{card})
            return emitWithoutSelf("Buy development card")
        }))

        socket.on("Build road",userActionFunctionFactory(async ({position})=>{
            const road = await doBuildRoad(socket.game,socket.userid,position)
            if(!road) throw Error(actionErrorMessage)
            return emitWithoutSelf("Build road",{position})
        }))

        socket.on("Build settlements",userActionFunctionFactory(async ({position})=>{
            const settlement = await doBuildSettlement(socket.game,socket.userid,position)
            if(!settlement) throw Error(actionErrorMessage)
            return emitWithoutSelf("Build settlements",{position})
        }))

        socket.on("Build city",userActionFunctionFactory(async ({position})=>{
            const city = await doBuildCity(socket.game,socket.userid,position)
            if(!city) throw Error(actionErrorMessage)
            return emitWithoutSelf("Build city",{position})
        }))

        socket.on("Use development card",userActionFunctionFactory(async ({card,data})=>{
            if(getTurnSpecificInfo('usedDevelopmentCard')) return
            setTurnSpecificInfo('usedDevelopmentCard',true)
            const doYouHaveTheCard = await doUseDevelopmentCard(socket.game,socket.userid,card)
            if(!doYouHaveTheCard) throw Error("You do not have that card")
            emitWithoutSelf("Use development card",{card})
            const resource = data.resource
            switch(card){
                case 'Monopoly':
                    if(resource !== 'Wheat' && resource !== 'Brick' && resource !== 'Sheep' && resource !== 'Wood' && resource !== 'Rock') return false
                    await doUseMonopolyCard(socket.game,socket.playerid,resource)
                    emitWithoutSelf("Monopoly resource chosen",{resource})
                    break;
                case "Knight":
                    changeStateToWaitingFor("Knight")
                    break
                case "Plenty":
                    const resource = data.resource
                    let totalResource = 0
                    for(r of resource){
                        totalResource+=resource[r]
                    }
                    if(totalResource !== 2) throw Error("More than 2 resources")
                    for(r of resource){
                        socket.user[`${r.toLowerCase()}Amount`]+=resource[r]
                    }
                    game.save()
                    emitWithoutSelf("Plency card chosen",{resource})
                    break
                case "Road":
                    const {positions} = data
                    if(!positions) throw Error("Position invalid")
                    if(positions.length !== 2) throw Error("Not the right amount of roads")
                    socket.user.woodAmount += 2
                    socket.user.brickAmount += 2
                    const tf1 = await doBuildRoad(socket.game,socket.userid,positions[0])
                    const tf2 = await doBuildRoad(socket.game,socket.userid,positions[1])
                    if(!(tf1 && tf2)) throw Error("Positions invalid")
                    break
                default:
                    throw Error("That card does not exist/Cannot be played.")
            }
        }))

        const waitingActionFunctionFactory = (func,id)=> asyncSocketWrap(async (...args)=>{
            if(!socket.game.inGame) throw Error("The game had ended")
            if(socket.userid !== socket.game.onTurn) throw Error("Not your turn")
            if(getTurnSpecificInfo("state") === 'normal') throw Error("You cannot do that action at this time")
            if(getTurnSpecificInfo("waitingFor") !== id) throw Error("Action is invalid")
            const result = await func(...args)
            if(result === false) throw Error("Action failed")
            else revertToNormalState()
        })

        socket.on("Move robber")
        socket.on("Sacrifice Resources")
    })
}