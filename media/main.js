// Init Vue

const vscode = acquireVsCodeApi();
var telemetries = {};
var commands = {};
var logs = [];
var telemBuffer = {};
var logBuffer = [];
var app = new Vue({
    el: '#app',
    data: {
        telemetries: telemetries,
        commands: commands,
        logs: logs,
        dataAvailable: false,
        cmdAvailable: false,
        logAvailable: false,
        telemRate: 0,
        logRate: 0,
        viewDuration: 0,
        leftPanelVisible: true,
        rightPanelVisible: true,
        serialPortList: [],
        serialPort : null,
        serialBaudrate: 115200,
        serialPortConnected : false,
        textToSend: "",
        sendTextLineEnding: "\\r\\n"
    },
    methods: {
        updateStats: function(telem){
            Vue.set(telem, "stats", computeStats(telem.data))
        },
        sendCmd: function(cmd) {
            socket.send(`|${cmd.name}|`);
        },
        toggleVisibility: function(telem) {
            telem.visible = !telem.visible;
            triggerChartResize();
        },
        onLogClick: function(log, index) {
            for(l of app.logs) l.selected = log.timestamp > 0 && l.timestamp == log.timestamp;
            logCursor.pub(log);
        },
        showLeftPanel: function(show) {
            app.leftPanelVisible=show;
            triggerChartResize();
        },
        showRightPanel: function(show) {
            app.rightPanelVisible=show;
            triggerChartResize();
        },
        listSerialPorts: function() {
            vscode.postMessage({ cmd: "listSerialPorts"});
        },
        connectSerialPort: function(port, baud) {
            vscode.postMessage({ cmd: "connectSerialPort", port: port, baud: baud});
        },
        disconnectSerialPort: function() {
            vscode.postMessage({ cmd: "disconnectSerialPort"});
        },
        clearAll: function() {
            logs.length = 0;
            Vue.set(app, 'logs', logs);
            logBuffer.length = 0;
            telemetries = {};
            Vue.set(app, 'telemetries', telemetries);
            commands = {};
            Vue.set(app, 'commands', commands);
            telemBuffer = {};
            app.dataAvailable = false;
            app.cmdAvailable = false;
            app.logAvailable = false;
        },
        sendText: function(text) {
            let escape = app.sendTextLineEnding.replace("\\n","\n");
            escape = escape.replace("\\r","\r");
            vscode.postMessage({ cmd: "sendToSerial", text: text+escape});
        }

    }
})

//Init refresh rate
setInterval(updateView, 60); // 15fps

logCursor = {
    cursor:{
        show: true,
        sync:{
            values:[0,0],
            scales:["x"],
            key: "cursorSync",
            filters: {pub: function(...e){return true}, sub: function(...e){return true}},
            match: [function(a,b){return a==b}],
            setSeries: true,
        },
        left: 10,
        top: 10,
        x: true,
        y: false
    },
    scales: {
        x:{ori:0, _max: 1, _min: 1, key:"x", time:true},
    },
    clientX: -10,
    clientY: -10,
    pub: function(log) {
        logCursor.cursor.sync.values[0] = log.timestamp/1000;
        logCursor.cursor.sync.values[1] = 0;
        window.cursorSync.pub("mousemove", logCursor, 0, 0, 0, 0, -42);
    }
};

// Init cursor sync
var timestampWindow = {min:0, max:0};
window.cursorSync = uPlot.sync("cursorSync");
window.cursorSync.sub({ pub:function(type, self, x, y, w, h, i){
    if(type=="mousemove"){
        if(i != -42){
            let timestamp = self.cursor.sync.values[0];
            for(l of app.logs) l.selected = Math.abs(l.timestamp/1000 - timestamp) < 0.1; // within 10ms difference (20ms window)
        }
        if(i != null) updateDisplayedVarValues(self.cursor.sync.values[0], self.cursor.sync.values[1]);
        else resetDisplayedVarValues();
    }
    // let some time to update the axes min/max
    setTimeout(()=>{
        timestampWindow.min = self.scales.x._min;
        timestampWindow.max = self.scales.x._max;
    }, 10);
    return true;
}});

var defaultPlotOpts = {
    title: "",
    width: 400,
    height: 250,
    //hooks: {setCursor: [function(e){console.log(e);}]},
    scales: {
        x: {
            time: true
        },
        y:{}
    },
    series: [
        {},
        {
            stroke: "red",
            fill: "rgba(255,0,0,0.1)"
        }
    ],
    cursor: {
        lock: false,
        focus: { prox: 16, },
        sync: {
            key: window.cursorSync.key,
            setSeries: true
        }
    },
    legend: {
        show: false
    }
};

window.addEventListener('message', message => {
    let msg = message.data;
    if("data" in msg) {
        parseData(msg, true);
    }
    else if("cmd" in msg) {
        parseVScmd(msg);
    }
});

function parseData(msgIn){
    let now = new Date().getTime();
    if(msgIn.fromSerial) now = msgIn.timestamp;
    //parse msg
    let msgList = (""+msgIn.data).split("\n");
    for(let msg of msgList){
        try{
            // Inverted logic on serial port for usability
            if(msgIn.fromSerial && msg.startsWith(">")) msg = msg.substring(1);// remove '>' to consider as variable
            else if(msgIn.fromSerial && !msg.startsWith(">")) msg = ">:"+msg;// add '>' to consider as log

            // Command
            if(msg.startsWith("|")){
                // Parse command list
                let cmdList = msg.split("|");
                for(let cmd of cmdList){
                    if(cmd.length==0) continue;
                    if(app.commands[cmd] == undefined){
                        let newCmd = {
                            name: cmd
                        };
                        Vue.set(app.commands, cmd, newCmd);
                    }
                }
                if(!app.cmdAvailable && Object.entries(app.commands).length>0) app.cmdAvailable = true;
            }
            // Log
            else if(msg.startsWith(">")){
                let currLog = {
                    timestamp: now,
                    text: ""
                }
                
                let logStart = msg.indexOf(":")+1;
                currLog.text = msg.substr(logStart);
                currLog.timestamp = parseFloat(msg.substr(1, logStart-2));
                if(isNaN(currLog.timestamp) || !isFinite(currLog.timestamp)) currLog.timestamp = now;
                logBuffer.unshift(currLog);//prepend log to buffer

                //logs.unshift(msg.substr(1));//prepend log to list
            }
            // Data
            else {
                // Extract series
                if(!msg.includes(':')) return;
                let startIdx = msg.indexOf(':');
                let name = msg.substr(0,msg.indexOf(':'));
                let endIdx = msg.indexOf('|');
                let flags = msg.substr(endIdx+1);
                if(endIdx == -1){
                    flags = "g";
                    endIdx = msg.length;
                }
                // Extract values array
                let values = msg.substr(startIdx+1, endIdx-startIdx-1).split(';')
                let xArray = [];
                let yArray = [];
                for(let value of values){
                    if(value.length==0) continue;
                    let sepIdx = value.indexOf(':');
                    if(sepIdx==-1){
                        xArray.push(now);
                        yArray.push(parseFloat(value));
                    }
                    else {
                        xArray.push(parseFloat(value.substr(0, sepIdx)));
                        yArray.push(parseFloat(value.substr(sepIdx+1)));
                    }
                }
                if(xArray.length>0){
                    appendData(name, xArray, yArray, flags)
                }
            }
        }
        catch(e){console.log(e)}
    }
}

function appendData(key, valuesX, valuesY, flags) {
    if(key.substring(0, 6) === "statsd") return;
    let isTimeBased = !flags.includes("xy");
    let shouldPlot = !flags.includes("np");
    if(app.telemetries[key] == undefined){
        let config = Object.assign({}, defaultPlotOpts);
        config.name = key;
        config.scales.x.time = isTimeBased;
        if(!isTimeBased){
            config.cursor.sync = undefined;
        }
        var obj = {
            name: key,
            flags: flags,
            data: [[],[]],
            value: 0,
            config: config,
            visible: shouldPlot
        };
        Vue.set(app.telemetries, key, obj)
        telemBuffer[key] = {data:[[],[]], value:0};
    }
    if(isTimeBased) valuesX.forEach((elem, idx, arr)=>arr[idx] = elem/1000); // convert timestamps to seconds

    // Flush data into buffer (to be flushed by updateView)
    telemBuffer[key].data[0].push(...valuesX);
    telemBuffer[key].data[1].push(...valuesY);
    telemBuffer[key].value = valuesY[valuesY.length-1];
    return;
}

var lastUpdateViewTimestamp = 0;
function updateView() {
    // Flush buffer into app model
    // Telemetry
    let dataSum = 0;
    for(let key in telemBuffer) {
        if(telemBuffer[key].data[0].length == 0) continue; // nothing to flush
        dataSum += telemBuffer[key].data[0].length;
        app.telemetries[key].data[0].push(...telemBuffer[key].data[0]);
        app.telemetries[key].data[1].push(...telemBuffer[key].data[1]);
        app.telemetries[key].value = telemBuffer[key].value
        telemBuffer[key].data[0].length = 0;
        telemBuffer[key].data[1].length = 0;
    }
    //Clear older data from viewDuration
    if(parseFloat(app.viewDuration)>0)
    {
        for(let key in app.telemetries) {
            let data = app.telemetries[key].data;
            let latestTimestamp = data[0][data[0].length-1];
            let minTimestamp = latestTimestamp - parseFloat(app.viewDuration);
            let minIdx = findClosestLowerByIdx(data[0], minTimestamp);
            if(data[0][minIdx]<minTimestamp) minIdx += 1;
            else continue;
            //if(minIdx>=data[0].length) break;
            app.telemetries[key].data[0].splice(0, minIdx);
            app.telemetries[key].data[1].splice(0, minIdx);
        }
    }

    if(!app.dataAvailable && Object.entries(app.telemetries).length>0) app.dataAvailable = true;

    // Logs
    var logSum = logBuffer.length;
    if(logBuffer.length>0) {
        app.logs.unshift(...logBuffer);//prepend log to list
        logBuffer.length = 0;
    }
    if(!app.logAvailable && app.logs.length>0) app.logAvailable = true;

    // Stats
    let now = new Date().getTime();
    if(lastUpdateViewTimestamp==0) lastUpdateViewTimestamp = now;
    let diff = now - lastUpdateViewTimestamp
    if(diff>0){
        app.telemRate = app.telemRate*0.8 + (1000/diff*dataSum)*0.2;
        app.logRate = app.logRate *0.8 + (1000/diff*logSum)*0.2;
    }
    lastUpdateViewTimestamp = now;
}

function exportSessionJSON() {
    let content = JSON.stringify({
        telemetries: app.telemetries,
        logs: app.logs,
        dataAvailable: app.dataAvailable,
        logAvailable: app.logAvailable
    });
    let now = new Date();
    let filename = `teleplot_${now.getFullYear()}-${now.getMonth()}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}.json`;
    
    vscode.postMessage({ cmd: "saveFile", file: {
        name: filename,
        content: content
    }});
}

function importSessionJSON(event) {
    var file = event.target.files[0];
    if (!file) {
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        try{
            let content = JSON.parse(e.target.result);
            for(let key in content) {
                Object.ass
                Vue.set(app, key, content[key]);
            }
            // Trigger a resize event after initial chart display
                triggerChartResize();
        }
        catch(e) {
            alert("Importation failed: "+e.toString());
        }
    };
    reader.readAsText(file);
}

function triggerChartResize(){
    setTimeout(()=>{
        window.dispatchEvent(new Event('resize'));
    }, 100);
}

function computeStats(data) {
    let stats = {
        min:0,
        max:0,
        sum:0,
        mean:0,
        med:0,
        stdev:0,
    };
    let values = data[1];
    //Find min/max indexes from timestampWindow
    let minIdx = 0, maxIdx = data[1].length;
    if(timestampWindow.min !=0 && timestampWindow.max != 0)
    {
        minIdx = findClosestLowerByIdx(data[0], timestampWindow.min) + 1;
        maxIdx = findClosestLowerByIdx(data[0], timestampWindow.max);
        if(maxIdx<=minIdx || maxIdx>=data[0].length) return stats;
        values = data[1].slice(minIdx, maxIdx);
    }
    if(values.length==0) return stats;
    // Sort
    let arr = values.slice().sort(function(a, b){return a - b;});
    // Min, Max
    stats.min = arr[0];
    stats.max = arr[arr.length-1];
    // Sum, Mean
    for(let i=0;i<arr.length;i++) {
        stats.sum += arr[i];
    }
    stats.mean = stats.sum / arr.length;
    // Stdev
    let stdevSum=0;
    for(let i=0;i<arr.length;i++) {
        stdevSum += (arr[i] - stats.mean) * (arr[i] - stats.mean);
    }
    stats.stdev = Math.sqrt(stdevSum/arr.length);
    // Median (only one that requires the costly sort)
    var midSize = arr.length / 2;
	stats.med = midSize % 1 ? arr[midSize - 0.5] : (arr[midSize - 1] + arr[midSize]) / 2;
    return stats;
}

function findClosestLowerByIdx(arr, n) {
    let from = 0,
        to = arr.length - 1,
        idx;
  
    while (from <= to) {
        idx = Math.floor((from + to) / 2);
  
        let isLowerLast = arr[idx] <= n && idx == arr.length-1;
        let isClosestLower = (idx+1 < arr.length-1) && (arr[idx] <= n) && (arr[idx+1] > n);
        if (isClosestLower || isLowerLast) {
            return idx;
        }
        else {
            if (arr[idx] > n)  to = idx - 1;
            else  from = idx + 1;
        }
    }
    return 0;
}

  function resetDisplayedVarValues(){
    //for each telem, set latest value
    let telemList = Object.keys(app.telemetries);
    for(let telemName of telemList) {
        let telem = app.telemetries[telemName];
        let idx = telem.data[0].length-1;
        if(0 <= idx && idx < telem.data[0].length) {
            telem.value = telem.data[1][idx];
        }
    }
}
function updateDisplayedVarValues(valueX, valueY){
    //for each telem, find closest value (before valueX and valueY)
    let telemList = Object.keys(app.telemetries);
    for(let telemName of telemList) {
        let telem = app.telemetries[telemName];
        let idx = findClosestLowerByIdx(telem.data[0], valueX);
        if(idx < telem.data[0].length) {
            telem.value = telem.data[1][idx];
        }
    }
}

setInterval(()=>{
    vscode.postMessage({ data: `|_telecmd_list_cmd|`});
}, 3000);

function parseVScmd(msg){
    if(msg.cmd == "serialPortList"){
        app.serialPortList = msg.list;
    }
    else if(msg.cmd == "serialPortConnect"){
        app.serialPortConnected = true;
    }
    else if(msg.cmd == "serialPortDisconnect"){
        app.serialPortConnected = false;
    }
}

vscode.postMessage({ cmd: "listSerialPorts"});