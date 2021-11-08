import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
const { SerialPort } = require('node-usb-native');
const Readline = require('@serialport/parser-readline')

const UDP_PORT = 47269;
const CMD_UDP_PORT = 47268;

const udp = require('dgram');

var serial : any = null;
var udpServer : any = null;
var currentPanel:vscode.WebviewPanel;
var _disposables: vscode.Disposable[] = [];
var statusBarIcon:any;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('teleplot.start', () => {
			startTeleplotServer();

			const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
			// If we already have a panel, show it.
			if (currentPanel) {
				currentPanel.reveal(column);
				return;
			}

			// Otherwise, create a new panel.
			const panel = vscode.window.createWebviewPanel('teleplot', 'Teleplot', column || vscode.ViewColumn.One,
				{
					enableScripts: true,
					localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))],
					retainContextWhenHidden: true,
					enableCommandUris: true
				}
			);
			currentPanel = panel;
			
			fs.readFile(path.join(context.extensionPath, 'media', 'index.html') ,(err,data) => {
				if(err) {console.error(err)}
				let rawHTML = data.toString();
				let replaceURI = (source:string, placeholder:string, path:any)=>{
					const stylePath = vscode.Uri.joinPath(context.extensionUri, ...path);
					const styleUri = panel.webview.asWebviewUri(stylePath);
					return (source as any).replaceAll(placeholder, styleUri.toString());
				}
				rawHTML = replaceURI(rawHTML, "{[styleURI]}", ['media', 'style.css']);
				rawHTML = replaceURI(rawHTML, "{[scriptURI]}", ['media', 'main.js']);
				rawHTML = replaceURI(rawHTML, "{[uPlotStyleURI]}", ['media', 'lib', 'uPlot.min.css']);
				rawHTML = replaceURI(rawHTML, "{[uPlotScriptURI]}", ['media', 'lib', 'uPlot.iife.min.js']);
				rawHTML = replaceURI(rawHTML, "{[uPlotComponentScriptURI]}", ['media', 'lib', 'uplot-component.js']);
				rawHTML = replaceURI(rawHTML, "{[vueScriptURI]}", ['media', 'lib', 'vue.js']);
				rawHTML = replaceURI(rawHTML, "{[logoMediaURI]}", ['media', 'images', 'logo-color.svg']);
				panel.webview.html = rawHTML;
			});

			panel.onDidDispose(() => {
				if(udpServer) {
					udpServer.close();
					udpServer = null;
				}
				while(_disposables.length) {
					const x = _disposables.pop();
					if(x) x.dispose();
				}
				_disposables.length = 0;
				if(serial) serial.close();
				serial = null;
				(currentPanel as any) = null;
			}, null, _disposables);

			panel.webview.onDidReceiveMessage( message => {
				if("data" in message) {
					var udpClient = udp.createSocket('udp4');
					udpClient.send(message.data, 0, message.data.length, CMD_UDP_PORT, ()=> {
						udpClient.close();
					});
				}
				else if("cmd" in message) {
					runCmd(message);
				}
			}, null, _disposables);
		})
	);

	statusBarIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarIcon.command = 'teleplot.start';
	statusBarIcon.text = "$(graph-line) Teleplot"
	context.subscriptions.push(statusBarIcon);
	statusBarIcon.show();
}

function startTeleplotServer(){
	// Setup UDP server
	udpServer = udp.createSocket('udp4');
	udpServer.bind(UDP_PORT);
	// Relay UDP packets to webview
	udpServer.on('message',function(msg:any,info:any){
		currentPanel.webview.postMessage({data: msg.toString(), fromSerial:false, timestamp: new Date().getTime()});
	});
}

var dataBuffer = "";
function runCmd(msg:any){
	if(msg.cmd == "listSerialPorts"){
		SerialPort.list().then((ports:any) => {
			currentPanel.webview.postMessage({cmd: "serialPortList", list: ports});
		});
	}
	else if(msg.cmd == "connectSerialPort"){
		serial = new SerialPort(msg.port, {baudRate: msg.baud});
		serial.on('open', function() {
			currentPanel.webview.postMessage({cmd: "serialPortConnect", port: msg.port, baud: msg.baud});
		})
		serial.on('error', function(err:any) {
			currentPanel.webview.postMessage({cmd: "serialPortError", port: msg.port, baud: msg.baud});
		})
		
		const parser = serial.pipe(new Readline({ delimiter: '\r\n' }));
		parser.on('data', function(data:any) {
			currentPanel.webview.postMessage({data: data.toString(), fromSerial:true, timestamp: new Date().getTime()});
		})
		serial.on('close', function(err:any) {
			currentPanel.webview.postMessage({cmd: "serialPortDisconnect"});
		})
	}
	else if(msg.cmd == "sendToSerial"){
		serial.write(msg.text);
	}
	else if(msg.cmd == "disconnectSerialPort"){
		serial.close();
	}
	else if(msg.cmd == "saveFile"){
		try {
			exportDataWithConfirmation(path.join(msg.file.name), { JSON: ["json"] }, msg.file.content);
		} catch (error) {
			void vscode.window.showErrorMessage("Couldn't write file: " + error);
		}
	}
}

function exportDataWithConfirmation(fileName: string, filters: { [name: string]: string[] }, data: string): void {
	void vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(fileName),
		filters,
	}).then((uri: vscode.Uri | undefined) => {
		if (uri) {
			const value = uri.fsPath;
			fs.writeFile(value, data, (error:any) => {
				if (error) {
					void vscode.window.showErrorMessage("Could not write to file: " + value + ": " + error.message);
				} else {
					void vscode.window.showInformationMessage("Saved " + value );
				}
			});
		}
	});
}