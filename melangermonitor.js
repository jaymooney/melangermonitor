var TMP007 = {
	I2CADDR: 0x40,
	DEVID: 0x1F,
	VOBJ: 0x00,
	TDIE: 0x01,
	CONFIG: 0x02,
	TOBJ: 0x03,
	STATUS: 0x04,
	STATMASK: 0x05,

	CFG_RESET: 0x8000,
	CFG_MODEON: 0x1000,
	CFG_1SAMPLE: 0x0000,
	CFG_2SAMPLE: 0x0200,
	CFG_4SAMPLE: 0x0400,
	CFG_8SAMPLE: 0x0600,
	CFG_16SAMPLE: 0x0800,
	CFG_ALERTEN: 0x0100,
	CFG_ALERTF: 0x0080,
	CFG_TRANSC: 0x0040,

	STAT_ALERTEN: 0x8000,
	STAT_CRTEN: 0x4000
};

var buf = new Buffer(2);
buf.writeUIntLE(TMP007.CFG_MODEON | TMP007.CFG_TRANSC | TMP007.CFG_8SAMPLE, 0, 2);
var defaultConfig = buf.readUIntBE(0, 2);

buf = new Buffer(2);
buf.writeUIntLE(TMP007.STAT_ALERTEN, TMP007.STAT_CRTEN, 0, 2);
var defaultStat = buf.readUIntBE(0, 2);

var Gpio = require("onoff").Gpio;
var i2c = require("i2c-bus");
var i2c1 = i2c.open(1, setupTMP007);
var express = require("express");
var app = express();
var expressWs = require("express-ws")(app);
var path = require("path");
var fs = require("fs");
var filename = "data_" + (new Date()).getTime() + ".csv";

var pins = {};

pins.switch = new Gpio(18, "in", "both");
pins.red = new Gpio(15, "low");
pins.green = new Gpio(14, "low");
pins.hall = new Gpio(4, "in", "both");

var logInterval = 1000 * 6;
var recording = false;
var trips = 0;
var lasttrip;
var lastrpm;
var lastobj;
var lastdie;
var outputTimer;
var loggerTimer;
var tempTimer;


pins.hall.watch(function(err, value) {
	if (err) throw err;
	if (value) {
// nothing
	} else {
if (recording) {
	trips++;
	var now = new Date().getTime();
	var diff = now - lasttrip;
	lasttrip = now;
	lastrpm = 60000 / diff;
}
	}
});

pins.switch.watch(toggleSwitch);

function toggleSwitch(err, value) {
	if (err) throw err;
	if (value) {
console.log("start recording");
broadcast({recording: true});
		pins.red.write(0);
		pins.green.write(1);
		trips = 0;
		lastrpm = 0;
		lastobj = 0;
		lastdie = 0;
		recording = true;
		lastrip = new Date().getTime();

		outputTimer = setInterval(output, 5000);
		loggerTimer = setInterval(logData, logInterval);
		tempTimer = setInterval(readTemp, 2000);
	} else {
		recording = false;
console.log("stopped recording");
broadcast({recording: false});
		pins.red.write(1);
		pins.green.write(0);
		clearInterval(outputTimer);
		clearInterval(loggerTimer);
		clearInterval(tempTimer);
	}
}

logHeader();

pins.switch.read(function (err, val) {
	if (!val) {
		pins.red.write(1);
		pins.green.write(0);
	} else {
		toggleSwitch(err, val);
	}
});

function setupTMP007(err) {
	if (err) throw err;
	i2c1.writeWord(TMP007.I2CADDR, TMP007.CONFIG, defaultConfig, aok);
	i2c1.writeWord(TMP007.I2CADDR, TMP007.STATMASK, defaultStat, aok);
}

function output() {
	console.log("tripped " + trips + " times, " + lastrpm + "rpm");
	console.log("die temp: " + lastdie + " F");
	console.log("obj temp: " + lastobj + " F");
	
	var data = {trips: trips, rpm: lastrpm, dietemp: lastdie, objtemp: lastobj};
	broadcast(data);
}

function logData() {
	var data = [(new Date()).getTime(), trips, lastrpm, lastobj, lastdie];
	writeCSV(data);
}

function logHeader() {
	writeCSV(["timestamp", "revolutions", "rpm", "melanger temperature", "ambient temperature"]);
}

function writeCSV(array) {
	fs.appendFile(filename, array.join(), aok);
}

function readTemp() {
	i2c1.readWord(TMP007.I2CADDR, TMP007.TDIE, function(err, val) {
		aok(err);
		var buf = new Buffer(2);
		buf.writeUIntBE(val, 0, 2);
		var celsius = rawToC(buf.readUIntLE(0, 2));
		lastdie = CtoF(celsius);
	});
	i2c1.readWord(TMP007.I2CADDR, TMP007.TOBJ, function(err, val) {
		aok(err);
		var buf = new Buffer(2);
		buf.writeUIntBE(val, 0, 2);
		var celsius = rawToC(buf.readUIntLE(0, 2));
		lastobj = CtoF(celsius);
	});
}

function aok(err) {
	if (err) throw err;
}
function rawToC(raw) {
	return (raw >> 2) * 0.03125;
}

function CtoF(celsius) {
	return celsius * 1.8 + 32;
}

function exit() {
	for (var k in pins) {
		pins[k].unexport();
	}
	i2c1.close(process.exit);
}

process.on("SIGINT", exit);



app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname + "/index.html"));
});

app.ws("/data", function(ws, res) {
	ws.on("open", function open() {
		console.log("client connected to stream");
		ws.send(JSON.stringify({recording: recording}));
	});
});

function broadcast(msg) {
	var d = expressWs.getWss("/data");
	var data = JSON.stringify(msg);
	d.clients.forEach(function each(client) {
		client.send(data);
	});
}

app.listen(8080);
