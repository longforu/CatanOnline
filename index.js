const express = require('express')
const app = new express
const server = require('http').createServer(app)
const io = require('socket.io')(server)
const mongoose = require('mongoose')
app.use(require('morgan')('common'));
app.use(require('helmet')());
app.use(require('compression')());
app.use(require('cors')());
app.use(require('body-parser').urlencoded({extended:true}));
app.use(require('body-parser').json());
require('express-async-errors')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const _ = require('lodash')

mongoose.connect(process.env.MONGODB_URI).then(()=>console.log("Connected to database"))
const {addPlayerToGame,playerSchema,gridSchema,gameSchema,Player,Grid,Game,findPoint,findTotalKnight,findPossibleActions,findLongestRoadLength,doBuyDevelopmentCard,doUseDevelopmentCard
    ,doBuildSettlementPlayer,doBuildCityPlayer,doBuildRoadPlayer,canBuildSettlementPlayer,canBuildRoadPlayer,doCreateGrid,findAllGridLocation,findPossibleNumberialSettlementLocation,findResourceFromDice,doBuildSettlementGrid,
    doBuildCityGrid,doBuildRoadGrid,findAdjacentPositionsTo,thereIsAStructureAt,findValidPlacesToBuildAStructure,findIfThereIsARoadAt,findRobberProspectiveLocations,doMoveRobberTo,doCreateGame,doBuildSettlement,doBuildCity,
    doBuildRoad,findAllPossibleRoadLocationFor,findWinCondition,doChangePlayerResource} = require('./Model/model')

require('./socket')(io)

app.use(express.static('./build'));
const path = require('path');
app.get('/',(req,res)=>{res.sendFile(path.join(__dirname,'./build','index.html'))});

app.post('/register',async (req,res)=>{
    const {roomCode,username} = req.body
    if(!username) return res.send({error:true,message:'Please enter a username'})
    if(!roomCode) return res.send({error:true,message:'Please enter a room code'})
    const game = await Game.findOne({roomCode})
    if(!game) return res.send({error:true,message:"Room not found"})
    else if(game.players.length === 4) return res.send({error:true,message:'Room is full'})
    else if(game.inGame) return res.send({error:true,message:"There's a game progressing in this room."})
    else{
        const id = await addPlayerToGame(game,username)
        const token = await jwt.sign({userid:id,roomCode},process.env.SECRET_KEY)
        return res.send({token})
    }
})

const characters = 'ABCDEFGHIJILMNOPQRSTUVWXYZ1234567890'

app.post('/create',async(req,res)=>{
    let roomCode = ''
    for(let i = 0;i<7;i++) roomCode+=characters[_.random(characters.length-1)]
    const {username} = req.body
    if(!username) return res.send({error:true,message:'Please enter a username'})
    const game = await doCreateGame(roomCode)
    const id = await addPlayerToGame(game,username)
    if(game === false || id === false) throw(new Error("Something went wrong"))
    const token = await jwt.sign({userid:id,roomCode},process.env.SECRET_KEY)
    return res.send({token})
})

app.use((err,req,res,next)=>{
    console.log(err);
    return res.send({error:true})
})

server.listen(process.env.PORT,()=>console.log(`Listening on ${process.env.PORT}`))