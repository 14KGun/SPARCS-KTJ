// require 과정
var express = require('express');
var http = require('http');
var https = require('https');
var path = require('path');

var expressErrorHandler = require('express-error-handler');
var errorHandler = require('errorhandler');
var bodyParser = require('body-parser');
var static = require('serve-static');
var cookieParser = require('cookie-parser');
var expressSession = require('express-session');
var ejs = require('ejs');
var fs = require('fs');
var mongoose = require('mongoose');
var socketio = require('socket.io');
var cors = require('cors');

var bkfd2Password = require("pbkdf2-password");
var hasher = bkfd2Password();

// 익스프레스 객체 생성
var app = express();
app.set('port', process.env.PORT || 80);
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({extended : false}));
app.use(bodyParser.json());

// static 미들웨어
app.use(static(path.join(__dirname, 'core')));
app.use('/favicon.ico',  express.static(path.join(__dirname, '/favicon.ico')));
app.use('/file', express.static(path.join(__dirname, '/support')));

// 쿠키 및 세션
app.use(cookieParser());
app.use(expressSession({ secret: '2020 KTJ', resave: true, saveUninitialized: true }));

// cors 미들웨어
app.use(cors());

// 몽고 디비 - 데이터베이스
var database;
var userSchema, roomSchema; // 데이터베이스 스키마 객체
var userModel, roomModel; // 데이터베이스 모델 객체
function connectDB(){
    var databaseUrl = 'mongodb://localhost:27017/local'
    
    console.log('데이터베이스 연결을 시도합니다.');
    mongoose.Promise = global.Promise;
    mongoose.connect(databaseUrl, {useNewUrlParser: true, useCreateIndex: true, useUnifiedTopology: true});
    database = mongoose.connection;
    
    database.on('error', console.error.bind(console,'mongoose connection error.'));
    database.on('open', function(){
        console.log('데이터베이스와 연결되었습니다.');
        
        var ObjectId = mongoose.Schema.Types.ObjectId;
        
        userSchema = mongoose.Schema({
            id: { type: String, required: true, unique: true },
            pw: { type: String, required: true },
            salt: { type: String, required: true },
            name: { type: String, required: true },
            room: { type: Array, required: true, default: [] }
        });
        roomSchema = mongoose.Schema({
            id: { type: String, required: true, unique: true },
            user: { type: Array, required: true, default: [] },
            chating: { type: Array, required: true, default: [] },
        });
        
        userModel = mongoose.model("users", userSchema);
        roomModel = mongoose.model("rooms", roomSchema);
    });
    database.on('disconnected', function(){
        console.log('데이터베이스와 연결이 끊어졌습니다. 5초 후 다시 연결합니다.');
        setInterval(connectDB, 5000);
    });
}

// 로그인 세션 관리
var login = {};
login.max_time = 3600000;
login.log = {};
login.in = function(req, name, id){
    req.session.user = { name: name, id : id };
    login.log[id] = { time: Date.now() }
}
login.out = function(req){
    if(login.check(req) == false) return;
    
    var id = login.id(req);
    req.session.destroy(function(err){
        if(err){ throw err; }
    });
}
login.check = function(req){
    if(req.session.user) {
        var time_flow = Date.now() - login.log[req.session.user.id].time;
        
        if(time_flow > login.max_time) return false;
        return true;
    }
    return false;
}
login.id = function(req){ return req.session.user.id; }
login.name = function(req){ return req.session.user.name; }

// header
var header_encoder = {};
header_encoder.ejs = fs.readFileSync('./support/header.ejs', 'utf8');
header_encoder.get = function(req){
    if(login.check(req)) return ejs.render(header_encoder.ejs, { login: true, id: login.id(req) });
    else return ejs.render(header_encoder.ejs, { login: false, id: 'none' });
}

// 예약가능한 날짜 및 시각
function available_time(){
    var time_now = new Date();
    var time_k = new Date(time_now.getFullYear(), time_now.getMonth(), time_now.getDate(), time_now.getHours(), 0, 0, 0);
    var time_list = [];
    
    while(time_list.length < 2*24*7){
        if(time_k >= time_now) time_list.push(time_k);
        time_k = new Date(time_k.getTime() + 30*60000);
    }
    return time_list;
}
function available_res(){
    var time_list = available_time();
    var res_list = [];
    
    res_list.push([time_list.shift()]);
    while(time_list.length > 0){
        var k_push = time_list.shift();
        var k_back = res_list[res_list.length-1][0];
        
        if(k_push.getDate() == k_back.getDate()){
            res_list[res_list.length-1].push(k_push);
        }
        else{
            res_list.push([k_push]);
        }
    }
    return res_list;
}
function trans_roomcode(date, s, e){
    var position_list = ['0','1'];
    if(position_list.indexOf(s) == -1) return 'none';
    if(position_list.indexOf(e) == -1) return 'none;'
    
    var y = date.getFullYear(), m = date.getMonth(), d = date.getDate(), h = date.getHours(), t = date.getMinutes();
    var code = y+'/'+m+'/'+d+'/'+h+'/'+t+'/'+s+'>'+e;
    //console.log(code);
    
    return code;
}

// 라우터 미들웨어
var router = express.Router();
router = express.Router();

router.route('/').get(function(req, res){
    fs.readFile('./core/main/main.html', 'utf8', function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        res.end(ejs.render(data,{
            header_html: header_encoder.get(req)
        }));
    });
});

function route_login(res, req, msg, id, pw){
    fs.readFile('./core/login/login.html', 'utf8', function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        res.end(ejs.render(data,{
            msg: msg, id: id, pw: pw,
            header_html: header_encoder.get(req)
        }));
    });
}
router.route('/login').get(function(req, res){
    route_login(res, req, '', '', '');
});
router.route('/logout').get(function(req, res){
    login.out(req);
    res.redirect('/');
});
router.route('/login/try-login').post(function(req, res){
    var p_id = req.body.id || req.query.id || '';
    var p_pw = req.body.pw || req.query.pw || '';
    
    if(p_id=='' || p_id.length<5 || p_id.length>15 || p_pw=='' || p_pw.length<5 || p_id.length>20){
        route_login(res, req, '해당 계정을 찾을 수 없습니다.', p_id, p_pw);
    }
    else{
        userModel.findOne({ id: p_id }, function(err, result){
            if(err) route_login(res, req, '서버 오류로 인해 로그인 할 수 없습니다.', p_id, p_pw);
            else if(!result) route_login(res, req, '해당 계정을 찾을 수 없습니다.', p_id, p_pw);
            else{
                hasher({ password: p_pw, salt: result.salt }, (err, pass, salt, hash) => {
                    if(err) route_login(res, req, '서버 오류로 인해 로그인 할 수 없습니다.', p_id, p_pw);
                    else if(hash == result.pw){ login.in(req, result.name, result.id); res.redirect('/'); }
                    else route_login(res, req, '해당 계정을 찾을 수 없습니다.', p_id, p_pw);
                });
            }
        });
    }
});

router.route('/login/joinus').get(function(req, res){
    var msg = req.body.msg || req.query.msg || '';
    
    fs.readFile('./core/login/joinus/joinus.html', 'utf8', async function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        res.end(data);
    });
});
router.route('/login/joinus/post').post(function(req, res){
    var p_id = req.body.id || req.query.id || '';
    var p_pw = req.body.pw || req.query.pw || '';
    var p_name = req.body.name || req.query.name || '';
    
    if(p_id=='' || p_id.length<5 || p_id.length>15 || p_pw=='' || p_pw.length<5 || p_id.length>20 || p_name=='' || p_name.length<2 || p_name.length>10){
         res.redirect('/error?msg=Failed to sign up(1)'); return; 
    }
    
    hasher({ password: p_pw }, (err, pass, salt, hash) => {
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        
        var user = new userModel({ id: p_id, pw: hash, salt: salt, name: p_name });
        user.save(function(err){
            if(err){ res.redirect('/error?msg=Failed to sign up(2)'); return; }
            else{
                login.in(req, p_name, p_id);
                res.redirect('/');
            }
        });
    });
});

router.route('/reservation').get(function(req, res){
    var msg = req.body.msg || req.query.msg || '';
    
    if(login.check(req)!=true){ res.redirect('/login'); return; }
    fs.readFile('./core/reservation/reservation.html', 'utf8', async function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        res.end(ejs.render(data,{
            av_list: available_res(),
            header_html: header_encoder.get(req)
        }));
    });
});

router.route('/reservation/:Pdate').get(function(req, res){
    var pdate = req.params.Pdate || '';
    var av_list = available_res();
    var ex_check = false;
    
    if(login.check(req)!=true){ res.redirect('/login'); return; }
    
    pdate = new Date(pdate);
    for(var i=0; i<av_list.length; i++){
        for(var j=0; j<av_list[i].length; j++){
            if(pdate-av_list[i][j] == 0) ex_check = true;
        }
    }
    if(ex_check==false){
        res.redirect('/error?msg=It is impossible to make a reservation'); return;
    }
    
    fs.readFile('./core/reservation/reservation2.html', 'utf8', async function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        res.end(ejs.render(data,{
            av_list: available_res(), pdate: pdate,
            header_html: header_encoder.get(req)
        }));
    });
});

router.route('/reservation-try').post(function(req, res){
    var pstart = req.body.start || req.query.start || '';
    var pend = req.body.end || req.query.end || '';
    var pdate = req.body.time || req.query.time || '';
    var av_list = available_res();
    var ex_check = false;
    
    if(login.check(req)!=true){ res.redirect('/login'); return; }
    var login_id = login.id(req);
    
    pdate = new Date(pdate);
    for(var i=0; i<av_list.length; i++){
        for(var j=0; j<av_list[i].length; j++){
            if(pdate-av_list[i][j] == 0) ex_check = true;
        }
    }
    if(ex_check==false){
        res.redirect('/error?msg=It is impossible to make a reservation'); return;
    }
    
    var room_code = trans_roomcode(pdate, pstart, pend);
    if(room_code == 'none'){ res.redirect('/error?msg=Invalid page requested'); return; }
    
    userModel.findOne({ id: login_id }, 'room', async function(err, result){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!result){ res.redirect('/error?msg=Server Error'); return; }
        
        if(result.room.indexOf(room_code)==-1){
            result.room.push(room_code);
            await userModel.updateOne({ id: login_id }, { room: result.room });
        }
        roomModel.findOne({ id: room_code }, 'user', async function(err, result){
            if(err){ res.redirect('/error?msg=Server Error'); return; }
            
            if(!result){
                var room = new roomModel({ id: room_code, user: [login_id], chating: [] });
                room.save(function(err){
                    if(err){ res.redirect('/error?msg=Server Error'); return; }
                    res.redirect('/mypage');
                });
            }
            else{
                result.user.push(login_id);
                await roomModel.updateOne({ id: room_code }, { user: result.user });
                res.redirect('/mypage');
            }
        })
    });
});

router.route('/mypage').get(function(req, res){
    var msg = req.body.msg || req.query.msg || '';
    
    if(login.check(req)!=true){ res.redirect('/login'); return; }
    fs.readFile('./core/mypage/mypage.html', 'utf8', function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        userModel.findOne({ id: login.id(req) }, 'id room', function(err, result){
            if(err){ res.redirect('/error?msg=Server Error'); return; }
            
            var rooms = [];
            result.room.sort();
            for(var i=0; i<result.room.length; i++){
                var k = result.room[i].split('/');
                var name = k[0]+'년 '+(parseInt(k[1])+1)+'월 '+k[2]+'일 ';
                var hour = parseInt(k[3]);
                
                if(hour>=12) name += '오후 ';
                else name += '오전 ';
                if(hour>=13) name += (hour-12)+'시 ';
                else name += hour+'시 ';
                name += k[4]+'분';
                
                var s = k[5].split('>')[0], e = k[5].split('>')[1];
                if(s=='0') s = '카이스트 택시 승강장';
                else s = '대전역';
                if(e=='0') e = '카이스트 택시 승강장';
                else e = '대전역';
                
                rooms.push({ code: result.room[i], name: name, start: s, end: e });
            }
            
            res.end(ejs.render(data,{
                room_list: rooms,
                header_html: header_encoder.get(req)
            }));
        })
    });
});

router.route('/chat').get(function(req, res){
    var room_code = req.body.room || req.query.room || '';
    
    if(login.check(req)!=true){ res.redirect('/login'); return; }
    
    fs.readFile('./core/chat/chat.html', 'utf8', function(err, data){
        if(err){ res.redirect('/error?msg=Server Error'); return; }
        if(!data){ res.redirect('/error?msg=Server Error'); return; }
        
        roomModel.findOne({ id: room_code }, function(err, result){
            if(err){ res.redirect('/error?msg=Server Error'); return; }
            if(!result){ res.redirect('/error?msg=Invalid page requested'); return; }
            
            var msg = [];
            if(result.user.indexOf(login.id(req))==-1){ res.redirect('/error?msg=Invalid page requested'); return; }
            for(var i=0; i<result.chating.length; i++){
                msg.push({ name: result.chating[i].name, msg: result.chating[i].msg });
            }

            res.end(ejs.render(data,{
                room: room_code, msg: msg, myname: login.id(req),
                header_html: header_encoder.get(req)
            }));
        });
    });
});

router.route('/error').get(function(req, res){
    var msg = req.body.msg || req.query.msg || '';
    
    res.end(msg);
    return;
});

app.use('/', router);
app.all('*', function(req,res){
    res.redirect('/error?msg=Invalid page requested');
});

// Express 서버 시작
var server_http = http.createServer(app).listen(80, function(){
    console.log('Express 서버가 80번 포트에서 시작됨.');
});

// 초기화 작업 실시
connectDB();

// Socket io 서버 시작
// socket.io 서버 - https
var io = socketio.listen(server_http);
console.log('socket: io 를 사용할 수 있습니다.');
io.on('connection', function(socket){
    socket.on('disconnect', () => {});
    socket.on('joinRoom', (room) => { socket.join(room); });
    socket.on('sendMsg', (msg) => {
        try{
            msg.room = msg.room.replace('&gt;','>');
            roomModel.findOne({ id: msg.room }, async function(err, result){
                if(err) return;
                if(!result) return;
                
                result.chating.push({ name: msg.name, msg: msg.msg });
                await roomModel.updateOne({ id: msg.room }, { chating: result.chating });
                io.to(msg.room.replace('>','&gt;')).emit('receiveMsg', { name: msg.name, msg: msg.msg });
            });
        } catch(error){ console.log(error); }
    });
    socket.on('joinus', (msg) => {
        userModel.findOne({ id: msg }, function(err, result){
            if(err) return;
            if(!result) io.to('joinus').emit('checkyourid', {id : msg, res : 'true'});
            else io.to('joinus').emit('checkyourid', {id : msg, res : 'false'});
        });
    });
});