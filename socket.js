const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const {passTurn,addPlayerToGame,playerSchema,gridSchema,gameSchema,Player,Grid,Game,findPoint,findTotalKnight,findPossibleActions,findLongestRoadLength,doBuyDevelopmentCard,doUseDevelopmentCard
    ,doBuildSettlementPlayer,doBuildCityPlayer,doBuildRoadPlayer,canBuildSettlementPlayer,canBuildRoadPlayer,doCreateGrid,findAllGridLocation,findPossibleInitialSettlementLocation,findResourceFromDice,doBuildSettlementGrid,
    doBuildCityGrid,doBuildRoadGrid,findAdjacentPositionsTo,thereIsAStructureAt,findValidPlacesToBuildAStructure,findIfThereIsARoadAt,findRobberProspectiveLocations,doMoveRobberTo,doCreateGame,doBuildSettlement,doBuildCity,
    doBuildRoad,findAllPossibleRoadLocationFor,findWinCondition,doChangePlayerResource,canBuyDevelopmentCardPlayer,doUseMonopolyCard} = require('./Model/model')
const _ = require('lodash')

//Todo list for today:
//+Set up the socket system for robber handling
//+Set up the socket system for initial settlement
//+Finish the socket system
//+Reevaluate how much time is left, then work on the front end with a new todo list

//To do list for tommorow
/*
    1. Build a testing set up
    2. Set up a full todo list
    First task: abstract the socket layer
*/


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
                waitingFor:[],
                waitingMessage:'',
                turn:-1,
                phase:0,
                waitingFunction:()=>{}
                //phase 1 is before dice action
                //phase 2 is after dice action
                //phase 3 is special action in the case of a robber
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

        const actionFunctionFactory = (func,message)=>socketFunctionFactory(async (data)=>{
            const phase = getTurnSpecificInfo('phase')
            if(getTurnSpecificInfo('state') !== 'normal') throw new Error("You cannot do that action at this time")
            if((phase === 1||phase === 2) && socket.playerid === socket.game.onTurn){
                try{await func(data);emitWithoutSelf(message,data)}catch(e){throw new Error(e.message)}
            }
            throw new Error('Not your turn')
        })

        const phase1ActionFunctionFactory = (func,message)=>actionFunctionFactory(async(data)=>{
            if(phase===1) return await func(data)
            throw new Error('This action can not be done at this time')
        },message)

        const phase2ActionFunctionFactory = (func,message)=>actionFunctionFactory(async(data)=>{
            if(phase===2) return await func(data)
            throw new Error('This action can not be done at this time')
        },message)

        const waitingFunctionFactory = (func,message)=>socketFunctionFactory(async (data)=>{
            if(getTurnSpecificInfo('state')=== 'normal') throw new Error('You cannot do this at this time')
            const arr = getTurnSpecificInfo('waitingFor')
            if(!arr.includes(socket.playerid)) throw new Error('You cannot do this at this time')
            if(getTurnSpecificInfo('waitingMessage') !== message) throw new Error('You cannot do this at this time')
            try{
                await func(data)
                const newArray = arr.filter(e=>e1==socket.playerid)
                if(newArray.length === 0){
                    changeToNormalState()
                }
            }
            catch(e){
                throw new Error(e.message)
            }
        })

        const attachActionToSocket = (message,func)=>socket.on(message,actionFunctionFactory(func,messge))
        const attachPhase1ActionToSocket = (message,func)=>socket.on(message,phase1ActionFunctionFactory(func,message))
        const attachPhase2ActionToSocket = (message,func)=>socket.on(message,phase2ActionFunctionFactory(func,message))

        const changeToWaitingState = (message,players)=>{
            setTurnSpecificInfo('state','waiting')
            setTurnSpecificInfo('waitingMessage',message)
            setTurnSpecificInfo('waitingFor',players)
            return new Promise(r=>setTurnSpecificInfo('waitingFunction',r))
        }

        const changeToNormalState = ()=>{
            setTurnSpecificInfo('state','normal')
            setTurnSpecificInfo('waitingMessage',"")
            setTurnSpecificInfo('waitingFor',[])
            const func = getTurnSpecificInfo('waitingFunction')
            func()
            setTurnSpecificInfo('waitingFunction',()=>{})
        }

        //Intiating the socket for use
        const {roomCode,userid} = jwt.verify(socket.handshake.query.token,process.env.SECRET_KEY)
        if(userid === undefined || !roomCode){
            socketError("Credential is invalid")
            socket.disconnect()
            return;
        }
        socket.roomCode = roomCode
        socket.userid = userid
        socket.game = await Game.findOne({roomCode})
        socket.user = socket.game.players[socket.userid]
        socket.username = socket.game.playerUsernames[socket.userid]
        socket.join(socket.roomCode)
        emitWithoutSelf('New player',{username:socket.username})
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

        const eventAwaitable = ['Roll Dice']
        const eventAwaitableFunctions = []
        const awaitEvent = (message)=>new Promise(r=>eventAwaitableFunctions[eventAwaitable.indexOf(message)].push(r))
        eventAwaitable.forEach((e,i)=>{
            eventAwaitableFunctions[i] = []
            socket.on(e,(data)=>{
                eventAwaitableFunctions[i].forEach(f=>f(data))
            })
        })

        //Controller
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
                actionNeeded(game)
            }
        })

        const robberNeeded = ()=>{

        }

        const passTurn = async ()=>{
            const win = await findWinCondition(socket.game)
            if(win !== false) return endGame(socket.game,win)
            else actionNeeded()
        }

        const endGame = ()=>{

        }

        const actionNeeded = async ()=>{
            cancelTurnTimer()
            resetTurnSpecificInfo()
            //Check if someone had win the game after every turn
            await passTurn(socket.game)
            emit('Action Needed',{turn:socket.game.onTurn})
        }

        //Events

        socket.on("Start game",asyncSocketWrap(()=>{if(socket.userid ===0) startGame(socket.game)}))

        socket.on("Pass turn",phase2ActionFunctionFactory(()=>{
            cancelTurnTimer()
            passTurn()
        }))

        socket.on("Trade Initiation",actionFunctionFactory(({players,resource})=>{
            emitWithoutSelf("Trade Initiation",{players,resource})
        }))

        socket.on("Trade Acceptance",userActionFunctionFactory(async ({players,resource})=>{
            const player2 = players
            const [resource1,resource2] = resource
            await doChangePlayerResource(socket.game,socket.userid,resource1)
            await doChangePlayerResource(socket.game,player2,resource2)
            emitWithoutSelf("Trade Acceptance",players,resource)
        }))

        socket.on('Trade counter',userActionFunctionFactory(async ()=>{

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
            await doChangePlayerResource(socket.game,socket.userid,take)
            await doChangePlayerResource(socket.game,socket.userid,negativeGive)
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

    })
}