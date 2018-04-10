// @ts-check

// Design fundamentals:

// SIMPLICITY
// There should be the LEAST amount of input necessary from the user to get things going.
// As much as can be automated should be, such as downloading all dependencies, like StarNet.jar or any modules automagically.
// Any dependencies should be functional for LINUX, WINDOWS, AND MAC --> NO OS DEPENDENT MODULES.
// Any information that can be grabbed should be grabbed automatically, such as the "SUPERADMINPASSWORD" from the starmade server.cfg file.
// When information is missing, this scripting should ask the user and make changes wher needed (such as asking for and then changing the server.cfg file for the SUPERADMINPASSWORD).

// No GUI  - NUFF SAID - TEXT CONSOLE FTW
// The servers that should be using this should be headless, so if we want to create a "GUI", we should create it as a web-app with focus on security.  Express is great for this sort of thing:

// MODDABILITY
// This wrapper will feature a high degree of moddability.  Everything will be event driven, so mods will be able to easily detect when events happen in game.
// There will be easy access to databases that both the wrapper and mods can maintain.  There will be "wrapper," "global", and "mod-level" databases.  By default, a mod should only have access to the "global" and "mod-level" databases, but we should have a specification for a "high level" mod that gets loaded in at the global scope so it can change the base functionality of the wrapper (if desired - AND ONLY WITH LOTS OF WARNINGS TO THE SERVER OWNER)
// I want a rich tapestry of built in methods that can perform functions such as grabbing the current faction of a specific player.  These should be able to send commands to the server, retrieve the data, parse it, and whittle it down to what is needed.  Sql queries will get special attention here, allowing the output to be easily parsable by mod scripting.

// DOCUMENTATION
// As the wrapper is built, documentation should be done alongside it.  All final versions of built-in functions and events should be documented carefully.

// NODE.JS JAVASCRIPT - MOSTLY NATIVE CODE
// Code should be mostly native to node.js javascript, using outside tools the least possible.  All outside tools must be includable or downloadable and freely usable on supported OS's, including linux, windows, and macosx.

// NPM REQUIRES OK - NO NEED TO RE-INVENT WHEELS
// Provided a NPM package seems stable enough, we can use them to expand the functionality of our scripting and decrease production time.  Care must be taken to ensure that performance isn't decreased significantly though.  -- NO GHETTO PACKAGES PLZ


// Exit codes
// 1: Lock file existed. Possible other server running.  Cannot start.
// 2: settings.json file did not contain all needed settings.
// 4: StarNet.jar did not exist and download failed due to a socks error, such as a failed connection.
// 5. StarNet.jar did not exist and download failed with HTTP response from webserver.  The HTTP error code will be available in the last line output by this script.

// ##############################
// ###    BUILT-IN REQUIRES   ###
// ##############################

// ### Built-in nodejs modules that should never need to be installed.
const http   = require('http');
const fs     = require('fs');
const events = require('events');
const spawn  = require('child_process').spawn;
const child  = require('child_process');
const path   = require('path'); // This is needed to build file and directory paths that will work in windows or linux or macosx.  For example, The / character is used in linu, but windows uses \ characters.  Windows also uses hard drive characters, wherease linux has mount points.  For example, in linux a path looks like "/path/to/somewhere", but in windows it looks like "c:\path\to\somewhere".  The path module takes care of this for us to build the path correctly.
// const stream   = require('stream'); // For creating streams.  Not used right now but may be later.

// ### Main Vars ### - Don't change these
var mainFolder      = path.dirname(require.main.filename); // This is where the starmade.js is
var binFolder       = path.join(mainFolder,"bin");
var operations      = 0;
var includePatterns = [];
var excludePatterns = [];
var serversRunning  = 0; // This is to count the server's running to manage the exit function and kill them when this main script dies.

// #######################
// ### SCRIPT REQUIRES ###
// #######################
// path.resolve below builds the full path to "./bin/setSettings.js" in such a way that is compatible with both windows and linux/macosx, since it doesn't use / or \ characters.
var setSettings = require(path.join(binFolder, "setSettings.js")); // This will confirm the settings.json file is created and the install folder is set up.
var installAndRequire = require(path.join(binFolder, "installAndRequire.js")); // This is used to install missing NPM modules and then require them without messing up the require cache with modules not found (which blocks requiring them till an app restart).


// #################################
// ### NPM DOWNLOADABLE REQUIRES ###
// #################################
const makeDir=installAndRequire('make-dir'); // https://www.npmjs.com/package/make-dir This allows creating folders recursively if they do not exist, with either async or sync functionality.
const treeKill=installAndRequire('tree-kill'); // https://www.npmjs.com/package/tree-kill To kill the server and any sub-processes
// const decache = installAndRequire("decache"); // https://www.npmjs.com/package/decache - This is used to reload requires, such as reloading a json file or mod without having to restart the scripting.
// const express = installAndRequire('express'); // https://www.npmjs.com/package/express Incredibly useful tool for serving web requests
// const targz = installAndRequire('tar.gz'); // https://www.npmjs.com/package/tar.gz2 For gunzipping files,folders, and streams (including download streams)
// const blessed = installAndRequire('blessed'); // https://www.npmjs.com/package/blessed Awesome terminal screen with boxes and all sorts of interesting things.  See here for examples:  https://github.com/yaronn/blessed-contrib/blob/master/README.md
const ini = installAndRequire('ini'); // https://www.npmjs.com/package/ini Imports ini files as objects.  It's a bit wonky with # style comments (in that it removes them and all text that follows) and leaves // type comments, so I created some scripting to modify how it loads ini files and also created some functions to handle comments.
const prompt = installAndRequire("prompt-sync")({"sigint":true}); // https://www.npmjs.com/package/prompt-sync - This creates sync prompts and can have auto-complete capabilties.  The sigint true part makes it so pressing CTRL + C sends the normal SIGINT to the parent javascript process
const Tail = installAndRequire('tail').Tail; // https://github.com/lucagrulla/node-tail/blob/master/README.md // For following the server log.  I forgot that the console output does NOT have everything.  This is NOT a perfect solution because whenever file rotation occurs, there is a 1 second gap in coverage.  Argh.
// ### Setting up submodules from requires.
var eventEmitter = new events.EventEmitter(); // This is for custom events

// #####################
// ###    SETTINGS   ###
// #####################
var lockFile                 = path.join(mainFolder,"server.lck");
var showStderr               = true;
var showStdout               = true;
var showServerlog            = true;
var showAllEvents            = false;
var enumerateEventArguments  = false;
var settingsFile             = path.join(mainFolder, "/settings.json");
var settings                 = setSettings(); // Import settings, including the starmade folder, min and max java settings, etc.  If the settings.json file does not exist, it will set it up.
var starNetJarURL            = "http://files.star-made.org/StarNet.jar";
var starMadeInstallFolder    = path.join(settings["starMadeFolder"],"StarMade");
var starMadeJar              = path.join(starMadeInstallFolder,"StarMade.jar");
var starNetJar               = path.join(binFolder,"StarNet.jar");
var starMadeServerConfigFile = path.join(starMadeInstallFolder,"server.cfg");
var serverCfg                = {}; // getIniFileAsObj('./server.cfg'); // I'm only declaring an empty array here initially because we don't want to try and load it till we are sure the install has been completed
var os=process.platform;
var starMadeStarter;
if (os=="win32"){
  starMadeStarter="StarMade-Starter.exe";
} else {
  starMadeStarter="StarMade-Starter.jar";
}
var starMadeInstaller = path.join(binFolder,starMadeStarter);
var starMadeInstallerURL = "http://files.star-made.org/" + starMadeStarter;
// Windows: http://files.star-made.org/StarMade-starter.exe
// macosx: http://files.star-made.org/StarMade-Starter.jar
// Linux: http://files.star-made.org/StarMade-Starter.jar

// ##################
// ### Lock Check ###  -- Temporary solution is to prevent this script from running if lock file exists
// ##################
if (fs.existsSync(lockFile)){
  //todo if the lock file exists, we need to grab the PID from the file and see if the server is running.  If not, then we can safely remove the lock file, otherwise end with an error.
  console.log("Lock file found!  Server already started!  Exiting!");
  process.exit(1);
}


// #####################
// ###    PATTERNS   ###
// #####################
// Patterns - This will be to detect things like connections, deaths, etc.  I'm pushing to an array so it's easier to add or remove patterns.

// Include Patterns
includePatterns.push("^\\[SERVER\\] MAIN CORE STARTED DESTRUCTION"); // This is for ship overheats.  It was implemented with systems 2.0, but it's bugged.  It fires off not only when ships overheat but also when they are destroyed.
includePatterns.push("^\\[SERVER\\]\\[SPAWN\\]");
includePatterns.push("^\\[SERVER\\]\\[DISCONNECT\\]"); // Player disconnects
includePatterns.push("^\\[PLAYER\\]\\[DEATH\\]");
includePatterns.push("^\\[SERVER\\] PlS\\[");
includePatterns.push("^\\[SERVER\\]\\[PLAYERMESSAGE\\]");
includePatterns.push("^\\[CHANNELROUTER\\]"); // These are messages sent from players
includePatterns.push("^\\[SERVER\\] Object Ship\\[");
includePatterns.push("^\\[CHARACTER\\]\\[GRAVITY\\] # This is the main gravity change");
includePatterns.push("^PlayerCharacter\\["); // # This handles killing creatures as a player as well as some wonky gravity changes.  I need to compare this to the main gravity changes to see if I should utilize it or not for that.
includePatterns.push("^Ship\\[ "); // # This handles killing NPC creatures from a ship and possibly other things.. but I haven't seen anything else in the logs to indicate the "other things"
includePatterns.push("^SpaceStation\\["); // # This handles killing NPC creatures from a station
includePatterns.push("^AICharacter\\["); // # This handles NPC creature deaths from other NPC characters
includePatterns.push("^Sector\\["); // # This handles NPC creature deaths via black hole or star damage
includePatterns.push("^Planet[(]"); // # This handles NPC creature death via planet
includePatterns.push("^ManagedAsteroid[(]"); // This handles NPC creature deaths via asteroids that have been modified in some way
includePatterns.push("^\\[DEATH\\]");
includePatterns.push("^\\[SPAWN\\]");
includePatterns.push("^\\[BLUEPRINT\\]"); // Blueprint spawns, including admin spawns.  They can be separated.
includePatterns.push("^\\[SEGMENTCONTROLLER\\] ENTITY");
includePatterns.push("^\\[FACTION\\]");
includePatterns.push("^\\[FACTIONMANAGER\\]");
includePatterns.push("^\\[SHUTDOWN\\]");  // When the server shuts down naturally

// Exclude Patterns
excludePatterns.push("^\\[SERVER\\]\\[DISCONNECT\\] Client 'null'"); // These spam all over the damn place so we want to filter them out.
excludePatterns.push("^\\[SERVER\\]\\[DISCONNECT\\] Client 'Info-Pinger \\(server-lists\\)'"); // Every time someone refreshes their server list from the main menu of the game, all servers have a message on their console.
excludePatterns.push(".*Narrowphase of Sector.*");
excludePatterns.push("^\\[BLUEPRINT\\]\\[SPAWNINDB\\]");

// Event found!: Sector[24](2, 2, 1) Narrowphase of Sector[24](2, 2, 1) took: 40; Objects in physics context: 8Arguments: 1



// Build the regex patterns into compact patterns.
var includePatternRegexTemp="(" + includePatterns[0];
for (var i=1;i<includePatterns.length;i++){ includePatternRegexTemp+="|" + includePatterns[i]; }
includePatternRegexTemp+=")"
var includePatternRegex=new RegExp(includePatternRegexTemp);
// console.log("includePatternRegex: " + includePatternRegex + "\n");
console.log("Include patterns loaded.");
var excludePatternRegexTemp="(" + excludePatterns[0];
for (let i=1;i<excludePatterns.length;i++){ excludePatternRegexTemp+="|" + excludePatterns[i]; }
//for (let e=1;e<excludePatterns.length;e++){ excludePatternRegexTemp+="|" + excludePatterns[e]; }
excludePatternRegexTemp+=")"
var excludePatternRegex=new RegExp(excludePatternRegexTemp);
// console.log("excludePatternRegex: " + excludePatternRegex + "\n");
console.log("Exclude patterns loaded.");

// console.log("Settings set: " + JSON.stringify(settings));

// Obsolete - This section was originally to load the settings.json file and use "default" values just for testing, this has been replaced by the setSettings.js scripting.
// try {
//   settings = require("./settings.json");
//   console.log("Imported settings values from settings.json.");
// } catch (ex) {
//     console.log("Settings.json file not found! Using default values");
//     settings = { // This is a temporary fallback during testing.  In the future if there is no settings.json file, we'll run an install routine instead to set the values and write the file.
//       "starMadeFolder": "/home/philip/Programs/StarMade/",
//       "javaMin": "128m",
//       "javaMax": "1024m",
//       "port": "4242"
//     };
// }

// Where is an existing StarMade folder
// What port would you like to use?  (Default 4242):

// Verify that all values are present and give an error if not enough settings are present.
if (!settings.hasOwnProperty('starMadeFolder') ||
  !settings.hasOwnProperty('javaMin') ||
  !settings.hasOwnProperty('javaMax') ||
  !settings.hasOwnProperty('port')){
    console.error("ERROR: settings.json file did not contain needed configuration options!  Exiting!");
    exitNow(2);
  }

// #########################
// ###    SERVER START   ###
// #########################
eventEmitter.on('ready', function() { // This won't fire off yet, it's just being declared so later on in the script it can be started.  I can modify this later if I want to allow more than one instance to be ran at a time.
  console.log("Starting server..");

  // #####  PLAYER MESSAGES  #####
  eventEmitter.on('message', function(message) { // Handle messages sent from players
    console.log("Message DETECTED from " + message.sender + " to " + message.receiver + ": " + message.text);
    if (message.text == "!command" ){
      console.log("!command found bitches!");
      let mMessage="/server_message_to plain " + message.sender + " 'Melvin: What the fack do you want?'";
      server.stdin.write(mMessage.toString().trim() + "\n");
      // server.stdin.end();
    }
  });

  eventEmitter.on('playerSpawn', function(playerSpawn) {
    console.log("playerSpawn detected.");
    let mMessage="/server_message_to plain " + playerSpawn.playerName + " 'Melvin: Well hello there, " + playerSpawn.playerName + "!  Thanks for spawning in!'";
    server.stdin.write(mMessage.toString().trim() + "\n");
  });
  eventEmitter.on('shipSpawn', function(shipSpawn) {
    console.log("shipSpawn detected.");
    let mMessage="/server_message_to plain " + shipSpawn.playerName + " 'Melvin: THAT is one nice ship: " + shipSpawn.shipName + "'";
    server.stdin.write(mMessage.toString().trim() + "\n");
  });
  eventEmitter.on('baseSpawn', function(baseSpawn) {
    console.log("baseSpawn detected.");
    let mMessage="/server_message_to plain " + baseSpawn.playerName + " 'Melvin: Cool new base dude! " + baseSpawn.baseName + "'";
    server.stdin.write(mMessage.toString().trim() + "\n");
  });


  // todo: Support for JVM arguments on the command line.

  // Taken from https://stackoverflow.com/questions/10232192/exec-display-stdout-live
  // Running the starmade server process
  try { // This is to catch an error if spawn cannot start the java process
    var server = spawn("java", ["-Xms" + settings["javaMin"], "-Xmx" + settings["javaMax"],"-jar", starMadeJar,"-server", "-port:" + settings["port"]], {"cwd": starMadeInstallFolder});
  } catch (err) { // This does NOT handle errors returned by the spawn process.  This only handles errors actually spawning the process in the first place, such as if we type "javaBlah" instead of "java".  Cannot run "javaBlah" since it doesn't exist.
    console.error("ERROR: Could not spawn server!")
    if (err.message) { console.error("Error Message: " + err.message.toString()); }
    if (err.code) { console.error("Error Code: " + err.code.toString()); }
    exitNow(130);
  }
  var tailOptions = {
    "fsWatchOptions": {"persistent": false},
    "follow": true
  };
  var serverTail = new Tail(path.join(starMadeInstallFolder,"logs","serverlog.0.log"),tailOptions);

  serversRunning++; // Increment the number of servers running.
  console.log('Spawned server process with PID:' + server.pid);
  var lockFileObj = fs.createWriteStream(lockFile);
  // function pidCB() { console.log("Wrote PID to lock file.."); }
  // lockFileObj.on('finish', function() { lockFileObj.close(pidCB); });
  lockFileObj.write(server.pid.toString());
  lockFileObj.end();

  // ####################
  // ###    WRAPPER   ###
  // ####################

  function processDataInput(dataInput){ // This function is run on every single line that is output by the server console.
    if (testMatch(dataInput)) { // Check to see if the message fits any of the regex patterns
      if (showAllEvents == true) {
        console.log("Event found!: " + dataInput + "Arguments: " + arguments.length);
      }
      let theArguments=arguments[0].split(" "); // This is to allow easier parsing of each individual word in the line
      if (enumerateEventArguments == true){
        for (let i=0;i<theArguments.length;i++){ console.log("theArguments[" + i + "]: " + theArguments[i]); }
      }
      // ### Player Messages ###
      if (theArguments[0] == "[CHANNELROUTER]"){ // This is for all messages, including commands.
        // I know this is a super messy way of processing the text.  I was stringing them along in 1 line apiece, but ESLint was yelling at me.  Here's some more ways to do it:  https://stackoverflow.com/questions/4092325/how-to-remove-part-of-a-string-before-a-in-javascript
        // let sender            = dataInput.match(/sender=[A-Za-z0-9_-]*/).toString();
        // let senderArray       = sender.split("=");
        // sender                = senderArray.pop();

        let sender            = dataInput.match(/sender=[A-Za-z0-9_-]*/).toString().split("=").pop();
        // let senderArray       = sender.split("=");
        // sender                = senderArray.pop();
        let receiver          = dataInput.match(/\[receiver=[A-Za-z0-9_-]*/).toString();
        let receiverArray     = receiver.split("=");
        receiver              = receiverArray.pop();
        let receiverType      = dataInput.match(/\[receiverType=[A-Za-z0-9_-]*/).toString();
        let receiverTypeArray = receiverType.split("=");
        receiverType          = receiverTypeArray.pop();
        let message           = dataInput.match(/\[message=.*\]$/).toString();
        let messageArray      = message.split("=");
        message               = messageArray.pop();
        messageArray          = message.split("");
        messageArray.pop();
        message=messageArray.join("");
        //arguments[0]: [CHANNELROUTER] RECEIVED MESSAGE ON Server(0): [CHAT][sender=Benevolent27][receiverType=CHANNEL][receiver=all][message=words]
        console.log("Message found: ");
        console.log("sender: " + sender);
        console.log("receiver: " + receiver);
        console.log("receiverType: " + receiverType);
        console.log("message: " + message);
        var messageObj={
          "sender":       sender,
          "receiver":     receiver,
          "receiverType": receiverType,
          "text":         message
        }
        eventEmitter.emit('message',messageObj);

      } else if (theArguments[0] == "[SERVER][SPAWN]" ) { // Player Spawns


          // Event found!: [SERVER][SPAWN] SPAWNING NEW CHARACTER FOR PlS[Benevolent27 ; id(2)(1)f(0)]Arguments: 1
          // theArguments[0]: [SERVER][SPAWN]
          // theArguments[1]: SPAWNING
          // theArguments[2]: NEW
          // theArguments[3]: CHARACTER
          // theArguments[4]: FOR
          // theArguments[5]: PlS[Benevolent27
          // theArguments[6]: ;
          // theArguments[7]: id(2)(1)f(0)]


        console.log("Parsing possible player spawn.  theArguments[5]: " + theArguments[5].toString());
        if (/PlS\[.*/.test(theArguments[5].toString())){
          let playerName=theArguments[5].split("[").pop();
          if (playerName) {
            console.log("Player Spawned: " + playerName);
            if (settings["announceSpawnsToMainChat"] == "true") {
              let mMessage="/server_message_broadcast plain " + "'" + playerName + " has spawned.'";
              server.stdin.write(mMessage.toString().trim() + "\n");
            }
            let playerObj={
              "playerName": playerName,
              "spawnTime": Math.floor(new Date() / 1000)
            }
            eventEmitter.emit('playerSpawn',playerObj);
          }
        }


          // Event found!: [SERVER] Object Ship[Benevolent27_1523388998134](355) didn't have a db entry yet. Creating entry!Arguments: 1
          // theArguments[0]: [SERVER]
          // theArguments[1]: Object
          // theArguments[2]: Ship[Benevolent27_1523388998134](355)
          // theArguments[3]: didn't
          // theArguments[4]: have
          // theArguments[5]: a
          // theArguments[6]: db
          // theArguments[7]: entry
          // theArguments[8]: yet.
          // theArguments[9]: Creating
          // theArguments[10]: entry!



      } else if (theArguments[0] == "[SPAWN]") { // New Ship or Base Creation
        // Event found!: [SERVER] Object Ship[Benevolent27_1523387756157](1447) didn't have a db entry yet. Creating entry!Arguments: 1
        console.log("Parsing possible ship or base spawn.");
        var playerName=theArguments[1];
        // var shipName=arguments[0].match(/spawned new ship: "[0-9a-zA-Z _-]*/);
        var shipName=arguments[0].match(/spawned new ship: ["][0-9a-zA-Z _-]*/);
        if (shipName){
          console.log("Temp shipName: " + shipName);
          shipName=shipName.toString().replace(/^spawned new ship: ["]/,'');
          // shipName=shipName.toString().split(":").pop();
          console.log("Temp shipName: " + shipName);
          let shipObj={
            "playerName": playerName,
            "shipName": shipName,
            "spawnTime" : Math.floor(new Date() / 1000)
          }
          eventEmitter.emit('shipSpawn',shipObj);
        } else {
          // var baseName=arguments[0].match(/spawned new station: "[0-9a-zA-Z _-]*/);
          var baseName=arguments[0].match(/spawned new station: ["][0-9a-zA-Z _-]*/);
          if (baseName){
            // baseName=baseName.split(":").pop();
            baseName=baseName.toString().replace(/^spawned new station: ["]/,'');

            // baseNameArray=baseName.split()
            let baseObj={
              "playerName": playerName,
              "baseName": baseName,
              "spawnTime" : Math.floor(new Date() / 1000)
            }
            eventEmitter.emit('baseSpawn',baseObj);
          }
        }
      } else if (theArguments[0] == /\[BLUEPRINT\].*/) { // Various Blueprint events
        if (theArguments[0] == "[BLUEPRINT][BUY]"){ // New Ship spawn from blueprint
          // Event found!: [BLUEPRINT][BUY] Benevolent27 bought blueprint from metaItem: "Isanth-VI" as "Isanth-VI1523389134208"; Price: 194625; to sector: (2, 2, 2) (loadTime: 80ms, spawnTime: 0ms)
          // [SERVER][META] removing metaID: 100320Arguments: 1
          // theArguments[0]: [BLUEPRINT][BUY]
          // theArguments[1]: Benevolent27
          // theArguments[2]: bought
          // theArguments[3]: blueprint
          // theArguments[4]: from
          // theArguments[5]: metaItem:
          // theArguments[6]: "Isanth-VI"
          // theArguments[7]: as
          // theArguments[8]: "Isanth-VI1523389134208";
          // theArguments[9]: Price:
          // theArguments[10]: 194625;
          // theArguments[11]: to
          // theArguments[12]: sector:
          // theArguments[13]: (2,
          // theArguments[14]: 2,
          // theArguments[15]: 2)
          // theArguments[16]: (loadTime:
          // theArguments[17]: 80ms,
          // theArguments[18]: spawnTime:
          // theArguments[19]: 0ms)
          // [SERVER][META]
          // theArguments[20]: removing
          // theArguments[21]: metaID:
          // theArguments[22]: 100320

          console.log("Some blueprint buy event happened.");
        } else if (theArguments[0] == "[BLUEPRINT][LOAD]"){ // New ship from load - possibly /spawn_mobs command
          console.log("Some blueprint load event happened.");
          // Event found!: [BLUEPRINT][LOAD] <admin> loaded Isanth-VI as "Isanth-VI_1523389201663" in (2, 2, 2) as faction 0Arguments: 1
          // theArguments[0]: [BLUEPRINT][LOAD]
          // theArguments[1]: <admin>
          // theArguments[2]: loaded
          // theArguments[3]: Isanth-VI
          // theArguments[4]: as
          // theArguments[5]: "Isanth-VI_1523389201663"
          // theArguments[6]: in
          // theArguments[7]: (2,
          // theArguments[8]: 2,
          // theArguments[9]: 2)
          // theArguments[10]: as
          // theArguments[11]: faction
          // theArguments[12]: 0

        }
          // Player Disconnects
          // Event found!: [SERVER][DISCONNECT] Client 'RegisteredClient: Benevolent27 (1) connected: true' HAS BEEN DISCONNECTED . PROBE: false; ProcessorID: 0Arguments: 1
          // theArguments[0]: [SERVER][DISCONNECT]
          // theArguments[1]: Client
          // theArguments[2]: 'RegisteredClient:
          // theArguments[3]: Benevolent27
          // theArguments[4]: (1)
          // theArguments[5]: connected:
          // theArguments[6]: true'
          // theArguments[7]: HAS
          // theArguments[8]: BEEN
          // theArguments[9]: DISCONNECTED
          // theArguments[10]: .
          // theArguments[11]: PROBE:
          // theArguments[12]: false;
          // theArguments[13]: ProcessorID:
          // theArguments[14]: 0


          // Event found!: [SERVER][PLAYERMESSAGE] received message request from PlS[Benevolent27 ; id(2)(1)f(0)] for 10 messagesArguments: 1
          // theArguments[0]: [SERVER][PLAYERMESSAGE]
          // theArguments[1]: received
          // theArguments[2]: message
          // theArguments[3]: request
          // theArguments[4]: from
          // theArguments[5]: PlS[Benevolent27
          // theArguments[6]: ;
          // theArguments[7]: id(2)(1)f(0)]
          // theArguments[8]: for
          // theArguments[9]: 10
          // theArguments[10]: messages

      }
    }
  }

  server.stdout.on('data', function (data) { // Displays the standard output from the starmade server
    let dataString=data.toString().trim(); // Clear out any blank lines
    if (dataString){
      if (showStdout == true) {
        console.log("stdout: " + dataString);
      }
      processDataInput(dataString); // Process the line to see if it matches any events
    }
  });

  server.stderr.on('data', function (data) { // Displays the error output from the starmade server
    let dataString=data.toString().trim(); // Clear out any blank lines
    if (dataString){
      if (showStderr == true) {
        console.log("stderr: " + dataString);
      }
      processDataInput(dataString); // Process the line to see if it matches any events
    }
  });

  serverTail.on('line', function(data) {
    let dataString=data.toString().trim().replace(/^\[[^\[]*\] */,'');
    if (dataString){
      // sed 's/^\[[^\[]*\][[:blank:]]*//g'
      if (showServerlog == true ) {
        console.log("serverlog: " + dataString);
      }
      processDataInput(dataString);
    }

  });

  process.on('exit', function() { // This is scoped so that it can terminate the starmade server when the main script ends.
    // This should kill the server, but ONLY if there is a server running.
    console.log("Scoped exit event running..");
    if (serversRunning>0){
      // Kill the processes, including all decendent processes.  For example, if we set the starmade server to actually be a script, then this will kill the script + the server.
      if (server.pid){
        console.log("Killing server PID, '" + server.pid + "' and all process descendants.");
        treeKill(server.pid, 'SIGTERM');
      }
      // We don't decrement the serversRunning value, because the "exit" event for the server process should do it.
    }
  });

  server.on('exit', function (code) { // This handles When the server child process ends, abormally or not.
    serversRunning--;
    if (code){
      if (code.message){
          console.log('Server instance exited with message: ' + code.message.toString());
      }
      console.log('Server instance exited with code: ' + code.toString());
    }
    serverTail.unwatch();
    exitNow(code); // This is temporary, we don't necessarily want to kill the wrapper when the process dies.  For example, maybe we want to respawn it?  Ya know?!
  });
  server.on('error', function (code) {
    // This runs is the java process could not start for some reason.
    console.error("ERROR:  Could not launch server process!")
    if (code.message){
        console.log('Error Message: ' + code.message.toString());
    }
    console.log('Exit code: ' + code.toString());
    exitNow(code); // This is temporary, we don't necessarily want to kill the wrapper when the process dies.
  });


  server.on('message', function(text) {
    console.log("Message found: " + text);
  });

  // server.stdin.setEncoding('utf-8');
  // process.stdin.pipe(server.stdin);
  // server.stdin.pipe(process.stdin);



  // #######################################
  // ###    COMMAND LINE WRAPPER START   ###
  // #######################################
  // This will process user input at the console and either direct it to the server process or parse it as a command.
  process.stdin.on('data', function(text){
    let theText=text.toString().trim();
    if (theText[0] == "!"){
      let theArguments = theText.split(" ");
      let theCommand   = theArguments.shift().toLowerCase();
      let tempArray    = theCommand.split("")
      tempArray.shift();
      theCommand=tempArray.join("");
      console.log("Wrapper command detected: " + theCommand)
      console.log("Full: " + theText);

      if (theCommand == "help" ) {
        console.log("Here are the current console commands:");
        console.log(" !stdout [on/off]");
        console.log(" !stderr [on/off]");
        console.log(" !serverlog [on/off]");
        console.log(" !enumerateevents [on/off]");
        console.log(" !showallevents [on/off]");
        console.log(" !settings list");
        console.log(" !changesetting [setting] [newvalue]");

      } else if (theCommand == "stdout" ) {
        if (theArguments[0] == "on"){
          console.log("Setting stdout to true!");
          showStdout=true;
        } else if (theArguments[0] == "off"){
          console.log("Setting showStdout to false!");
          showStdout=false;
        } else {
          console.log("Invalid parameter.  Usage:  !stdout on/off")
        }
      } else if (theCommand == "stderr" ) {
        if (theArguments[0] == "on"){
          console.log("Setting showStderr to true!");
          showStderr=true;
        } else if (theArguments[0] == "off"){
          console.log("Setting Stderr to false!");
          showStderr=false;
        }
      } else if (theCommand == "serverlog" ) {
        if (theArguments[0] == "on"){
          console.log("Setting showServerlog to true!");
          showServerlog=true;
        } else if (theArguments[0] == "off"){
          console.log("Setting showServerlog to false!");
          showServerlog=false;
        }
      } else if (theCommand == "enumerateevents" ) {
        if (theArguments[0] == "on"){
          console.log("Setting enumerateEventArguments to true!");
          enumerateEventArguments=true;
        } else if (theArguments[0] == "off"){
          console.log("Setting enumerateEventArguments to false!");
          enumerateEventArguments=false;
        }
      } else if (theCommand == "showallevents" ) {
        if (theArguments[0] == "on"){
          console.log("Setting showAllEvents to true!");
          showAllEvents=true;
        } else if (theArguments[0] == "off"){
          console.log("Setting showAllEvents to false!");
          showAllEvents=false;
        }
      } else if (theCommand == "settings") {
        if (theArguments[0] == "list"){
          // const copy = Object.create(Object.getPrototypeOf(settings));
          console.log("\nHere are your current settings:")
          const propNames = Object.getOwnPropertyNames(settings);
          propNames.forEach(function(name){
            // console.log("Setting: " + name + " Value: " + Object.getOwnPropertyDescriptor(settings, name));
            if (name != "smTermsAgreedTo"){ console.log(" " + name + ": " + settings[name]); }
          });
          console.log("\nIf you would like to change a setting, try !changesetting [SettingName] [NewValue]");
        }
      } else if (theCommand == "changesetting") {
        let showUsage = function(){ console.log("Usage: !changeSetting [Property] [NewValue]"); }; // Ignore this ESLinter warning, I WANT this to be scoped how it is, I do NOT want to declare with function which will give it a wider scope
        if (theArguments[0]){
          // console.log("Result of checking hasOwnProperty with " + theArguments[0] + ": " + settings.hasOwnProperty(theArguments[0]));
          if (settings.hasOwnProperty(theArguments[0])){

            let oldSettings=copyObj(settings);
            let settingNameToChange=theArguments.shift();
            let newSetting=theArguments.join(" ");
            if (newSetting){
              console.log("\nChanged setting from: " + oldSettings[settingNameToChange]);
              settings[settingNameToChange]=newSetting;
              console.log("Changed setting to: " + settings[settingNameToChange]);
              console.log("Settings update will take effect next time the server is restarted.")
              writeSettings();
            } else {
              console.log("ERROR: You need to specify WHAT you wish to change the setting, '', to!");
              showUsage();
            }
          } else {
            console.log("ERROR:  Cannot change setting, '" + theArguments[0] + "'! No such setting: ");
          }
        } else {
          console.log("ERROR:  Please provide a setting to change!");
          showUsage();
        }
      }
    } else {
      console.log("Running Command: " + theText);
      server.stdin.write(theText + "\n");
      // server.stdin.write(text.toString() + "\n");
      // server.stdin.end();
    }
  });

  // This is great to have all the info show on the screen, but how does one turn off a pipe? No idea.  I'll use events instead.
  // server.stdout.pipe(process.stdout);
  // server.stderr.pipe(process.stdout);

  // var stdinStream = new stream.Readable();

});

// #####################
// ###   EMITTERS   ####
// #####################
eventEmitter.on('asyncDone', installDepsSync);

// ####################
// ###  FUNCTIONS  ####
// ####################

// ### INI Stuff ###
function getIniFileAsObj(iniFile){ // This requires the ini module from npm
  return ini.parse(fs.readFileSync(iniFile, 'utf-8' ).replace(/[#]/g,"\\#")); // We need to escape the # characters because otherwise the ini.parse removes them and all text that happens after them.. Annoying if we are preserving the comments!
}
function writeObjToIni(theObj,iniFileToWrite){
  // console.log("Writing to file: " + iniFileToWrite);
  return fs.writeFileSync(iniFileToWrite, ini.stringify(theObj));
}
function removeIniComments(text){
  return text.match(/^[^/#]*/).toString().trim();
}
function getComment(text,commentSymbols){ // Comment symbols are optional
    var commentSymbolsToUse;
    if (commentSymbols){
      commentSymbolsToUse=commentSymbols;
    } else {
      commentSymbolsToUse=["//","#"]; // By default we are going to be reading from ini files that use // or # as their comments.
    }
    var regexArray=[];
    for (let i=0;i<commentSymbolsToUse.length;i++){
      regexArray.push(new RegExp(" *" + commentSymbolsToUse[i] + "+(.+)")); // Preserves spaces in front of the comment
    }
    var valToBeat="";
    for (let e=0;e<regexArray.length;e++){
      // console.log("Working with regex pattern: " + regexArray[e]);
      if (regexArray[e].exec(text)){
        if (!valToBeat){
          valToBeat=regexArray[e].exec(text)[0];
        } else if (valToBeat.length < regexArray[e].exec(text)[0].length){
          valToBeat=regexArray[e].exec(text)[0];
        }
      }
    }
    return valToBeat;
}
function keepIniComment(stringWComments,newVal){
    if (stringWComments && newVal){
      return newVal + getComment(stringWComments);
    }
    throw new Error("ERROR: Please specify a string from an ini object and a new value to replace the old one with!");
}
// ### end INI STUFF ###


function isAlphaNumeric(testString){
  return "/^[A-Za-z0-9]+$/".test(testString);
}

function getRandomAlphaNumericString(charLength){ // If no charlength given or it is invalid, it will output 10 and throw an error message. // Original code from: https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var outputLength=10;
  if (charLength){
    if (isNaN(parseInt(charLength))){
      console.error("ERROR: Invalid length given to getRandomAlphaNumeric function!  Set to default length of 10.  Here is what as given as input: " + charLength);
    } else {
      outputLength=parseInt(charLength);
    }
  } else {
    console.error("ERROR:  No charLength specified, using default of 10!");
  }
  for (var i = 0;i < outputLength;i++){
    text += possible.charAt(Math.floor(Math.random() * possible.length)).toString();
  }
  return text;
}



function sleep(ms) { // This will only work within async functions.
  // Usage: await sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyObj(obj) { // From:  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
  const copy = Object.create(Object.getPrototypeOf(obj));
  const propNames = Object.getOwnPropertyNames(obj);
  propNames.forEach(function(name) {
    const desc = Object.getOwnPropertyDescriptor(obj, name);
    Object.defineProperty(copy, name, desc);
  });
  return copy;
}

function writeSettings() {
  var settingsFileName=path.basename(settingsFile);
  try {
    var settingsFileStream=fs.createWriteStream(settingsFile);
    settingsFileStream.write(JSON.stringify(settings, null, 4));
    settingsFileStream.end();
    console.log("Updated '" + settingsFileName + "' file.");
  } catch (err) {
    console.error("ERROR: Could not write to the '" + settingsFileName + "' file!");
    throw err;
  }
}


function touch (file){ // This creates an empty file quickly.
  fs.closeSync(fs.openSync(file, 'w'));
}
function simpleDelete (file) { // Simple delete which doesn't resolve paths nor break out of the scripting by throwing an error.  It also does not display anything unless there is an error.
  try {
    fs.unlinkSync(file);
    // console.log("File, , " + file + ", deleted!");
  } catch(err) {
    console.error("File, " + file + ", cannot be deleted.");
  }
}

function ensureDelete (fileToDelete,options){
  // Resolves files to use main script path as root if given relative path.
  // Also throws an error if it cannot delete the file.
  // Default behavior is to be quite, unless "quiet" is set to "false" from an options object.
  var console={};
  if (options) {
    if (options.hasOwnProperty("quiet")){
       if (options.quiet != false) {
         console.log("Setting up scoped console to disable it.");
         console.log=function(){ /* empty on purpose */ };
         console.error=function(){ /* empty on purpose */ };
       }
    }
  } else {
    console.log=function(){ /* empty on purpose */ };
    console.error=function(){ /* empty on purpose */ };
  }
  let resolvedFile = path.resolve(mainFolder,fileToDelete); // This will resolve relative paths back to the main script's root dir as the base
  if (fs.existsSync(resolvedFile)){
    try {
      fs.unlinkSync(resolvedFile);
      console.log("Deleting: " + fileToDelete);
    } catch (err) {
      console.error("ERROR: Could not delete file: " + resolvedFile);
      console.error("Please manually remove this file and ENSURE you have access to delete files at this location!")
      throw err;
    }
  } else {
    console.error("ERROR: Cannot delete file.  File not found: " + resolvedFile);
  }
}

function exitNow(code) {
  console.log("Deleting lock file.");
  simpleDelete(lockFile);
  console.log("Exiting main script with exit code: " + code);
  process.exit(code);
}

function ensureFolderExists (folderPath){ // Returns true if the folder exists or if it can be created and then exists, otherwise throws an error.
  let resolvedFolderPath=path.resolve(folderPath); // Using resolve to ensure the path is specified in the right way for the OS.  Resolve tack on the current working directory to make it a full path if needed, which may NOT be the same as the folder starmade.js is in because this is meant to be a general purpose function and not necessarily tied to the starmade.js script.
  try {
    fs.accessSync(resolvedFolderPath,fs.constants.F_OK);  //  Check if the path can be seen.
      if (fs.statSync(resolvedFolderPath).isFile()) { // Check if it is a file
        let theError = new Error("Cannot create folder!  File already exists at this path!  Please delete or move: '" + resolvedFolderPath);
        throw theError;
      } else if (fs.statSync(resolvedFolderPath).isFIFO()) {
        let theError = new Error("Cannot create folder!  Named Pipe already exists at this path!  Please delete or move: '" + resolvedFolderPath);
        throw theError;
      } else { return true; } // it might be a symlink, but I don't know how to check if it's symlinked to a file or folder, so let's just assume it is fine.
  } catch (err) {
    console.log("Folder not found, creating: " + folderPath);
    try {
      // fs.mkdirSync(folderPath);  // This will only create the folder IF no other folders between need to be created, using the nodejs built in fs.
      makeDir.sync(folderPath); // This will create the folder and any inbetween needed, but requires the make-dir module.
      return true;
    } catch (error) {
      console.error("ERROR: Unable to create folder: " + folderPath);
      throw error; // Forward the error given by makeDir and throw it.
    }
  }
}

var operationMessages=[]; // This is unused for now, but it can be used to see the operations that completed and their order if they were named.
function asyncOperation(val){ // This controls when the start operation occurs.  All file reads, downloads, installs, etc, must be completed before this will trigger the "ready" event.
  // console.log("operations ongoing: " + operations + " Command given: " + val);
  var operationMessage=".";
  if (arguments[1]){
    operationMessage=": " + arguments[1];
  }
  if (val == "start"){ // Start is used when an asyncronous operation starts and end should be used when it's finished.
    operations++;
    // console.log("Operation started" + operationMessage);
  } else if (val == "end"){
    // console.log("Operation ended" + operationMessage);
    operationMessages.push("Operation ended" + operationMessage);
    if (operations>1){
      operations--;
    } else {
      console.log("Async operations finished.");
      eventEmitter.emit('asyncDone');
    }
  }
}

function preDownload(httpURL,fileToPlace){ // This function handles the pre-downloading of files, such as StarNet.jar.  When all downloads are finished, the StarMade server is started by emitting the event signal, "ready".
  // Code adapted from: https://stackoverflow.com/questions/11944932/how-to-download-a-file-with-node-js-without-using-third-party-libraries
  asyncOperation("start","preDownload: " + fileToPlace);
  let tempFileToPlace=path.resolve(mainFolder,fileToPlace + ".tmp");
  ensureDelete(tempFileToPlace);
  let resolvedFileToPlace=path.resolve(mainFolder,fileToPlace);
  let baseFileToPlace=path.basename(resolvedFileToPlace);
  let baseDirForFile=path.dirname(resolvedFileToPlace);

  // Check to see if the file already exists or not.  If it does exist, then we can end this operation.
  // fs.accessSync(resolvedFileToPlace),fs.constants.F_OK); // Supposed to check if the file can be seen but it was not working for me for some reason.
  if (fs.existsSync(resolvedFileToPlace)) { // We can see that a file, directory, or symlink exists at the target path
    if (fs.statSync(resolvedFileToPlace).isFile()){
      // console.log("'" + baseFileToPlace + "' existed.  Good!"); // File already exists, nothing to do.
      asyncOperation("end","preDownload: " + fileToPlace);
      return true;
    } else if (fs.statSync(resolvedFileToPlace).isDirectory()){
      throw new Error("ERROR: Cannot pre-download file: " + resolvedFileToPlace + "\nDirectory already exists with the name!  Please remove this directory and run this script again!");
    } else {
      throw new Error("ERROR: Cannot pre-download file: " + resolvedFileToPlace + "\nPath already exists with the name!  Please rectify this and then run this script again!");
    }
  } else { // If the file does not exist, let's download it.
    console.log("Downloading '" + baseFileToPlace + "' from: " + httpURL);
    ensureFolderExists(baseDirForFile); // ensure the directory the file needs to be placed in exists before trying to write to the file.
    var file = fs.createWriteStream(tempFileToPlace); // Open up a write stream to the temporary file.  We are using a temporary file to ensure the file will only exist at the target IF the download is a success and the file write finishes.
    try {
      var request = http.get(httpURL, function(response) {
        // console.log("Status Code: " + response.statusCode);
        // When the file is downloaded with the "http.get" method, it returns an object from which you can get the HTTP status code.
        // 200 means it was successfully downloaded, anything else is a failure.  Such as 404.
        if (response.statusCode == 200){
          response.pipe(file);
        } else {
          console.error("Error downloading file, '" + baseFileToPlace + "'!  HTTP Code: " + response.statusCode);
          throw new Error("Response from HTTP server: " + response.statusMessage);
          // exitNow(5);
        };
      });
      request.on('error', (e) => {
        throw new Error(`problem with request: ${e.message}`);
        // exitNow(4);
      });
    } catch (err) { // If there was any trouble connecting to the server, then hopefully this will catch those errors and exit the wrapper.
      console.log("ERROR:  Failed to download, '" + httpURL + "'!");
      throw err;
      // exitNow(4);
    }
    file.on('finish', function() {
      file.close();
      fs.rename(tempFileToPlace, resolvedFileToPlace, (err) => {
        if (err) { throw err; }
        console.log("'" + baseFileToPlace + "' downloaded successfully! :D");
        asyncOperation("end","preDownload: " + fileToPlace); // We're using a function to keep track of all ongoing operations and only triggering the start event when all are complete.  So let's complete this operation.
      });
    });
  }
  return true;
}

function testMatch(valToCheck) { // This function will be called on EVERY line the wrapper outputs to see if the line matches a known event or not.
  if (includePatternRegex.test(valToCheck)){
    if (!excludePatternRegex.test(valToCheck)){
      return true;
    }
    return false;

  } else {
    return false;
  }
}

// ##########################################
// ###  MAIN SCRIPT EXIT  - GLOBAL SCOPE ####
// ##########################################

process.on('exit', function() {
  // Cleanup that needs to be done on the global scope should be done here.
  console.log("Global Exit event running..");
});

touch(lockFile); // Create an empty lock file.  This is to prevent this script from running multiple times.

// ##############################
// ### CREATE NEEDED FOLDERS  ###
// ##############################

ensureFolderExists(binFolder);
ensureFolderExists(starMadeInstallFolder); // This is redundant, handling if the person deletes or moves their install folder.

// ###################################
// ### DEPENDENCIES AND DOWNLOADS  ###
// ###################################
// Check for dependencies, such as StarNet.jar and download/install if needed.
// When all dependency downloads/installs are finished, start the server!
console.log("Ensuring all dependencies are downloaded or installed..");

// ### Async downloads/installs that have no dependencies ### -- This sub-section is for all installs/downloads that can be done asynchronously to occur as quickly as possible.
asyncOperation("start"); // This prevents the first async function from starting the wrapper if it finishes before the next one starts.
preDownload(starNetJarURL,starNetJar); // This function handles the asyncronous downloads and starts the sync event when finished.
preDownload(starMadeInstallerURL,starMadeInstaller); // This is temporary, because we HAVE TO verify that the person has read and agreed to the SM terms of service prior to installing.
asyncOperation("end");

// ### Sync downloads/installs ### -- When async installs/downloads are finished, this function will be called.
async function installDepsSync() {
  // inside an async function we can use await to wait for each function call to end before moving to the next. eg. await installRoutine();

  // ### Only syncronous installs here ###

  // Let's see if the starmade jar file exists, and install StarMade to the installer path if not.
  if (!fs.existsSync(starMadeJar)){
    console.log("StarMade does not appear to be installed already.  Installing now..");
    // function installStarMade(){
    //   var smInstallerProcess=child.spawnSync("java",["-jar",starMadeInstaller,"-nogui"],{"cwd": settings["starMadeFolder"]});
    //   return smInstallerProcess;
    // }
    // await installStarMade();
    var smInstallerProcess=child.spawnSync("java",["-jar",starMadeInstaller,"-nogui"],{"cwd": settings["starMadeFolder"]});
    console.log("Install PID: " + smInstallerProcess.pid);
  }

  // ### IMPORTANT INFO REGARDING EDITING THE SERVER.CFG AND OTHER INI FILES:
  // To READ values, we can use serverCfg["WHATEVER"] to get the values.
  // Beware though, comments are imported as part of the value!  You you can strip them away with the removeIniComments() function that I created.
  // For example:  removeIniComments(serverCfg["WHATEVER"]) will retun only the needed value.

  // When CHANGING a value, we should KEEP the existing comments!  So for example, here I change a value but keep the comments:
  // In this example excerpt from an Ini file, we have a comment.
  // WHATEVER=OLD VALUE // This is an IMPORTANT ini comment
  //
  // If we set use: iniImport["WHATEVER"]="New Value..", then write the ini file, it will come out looking like this:
  // WHATEVER=New Value..
  //
  // We don't want to lose that IMPORTANT comment, do we?  So instead, we should use my keepIniComment() function when replacing values in the ini object.
  // serverCfg["WHATEVER"]=keepIniComment(serverCfg["WHATEVER"],"New Value!");
  //
  // The newly written ini file will look like this:
  // WHATEVER=New Value! // This is an IMPORTANT ini comment

  // If we want to write the iniObj to disk, then use writeObjToIni(serverCfg,starMadeServerCfgFile)
  // IMPORTANT:  Please keep the comments when changing values, so use


  serverCfg = getIniFileAsObj(starMadeServerConfigFile); // Import the server.cfg values to an object
  var superAdminPassword=removeIniComments(serverCfg["SUPER_ADMIN_PASSWORD"]);
  var superAdminPasswordEnabled=removeIniComments(serverCfg["SUPER_ADMIN_PASSWORD_USE"]);
  if (superAdminPasswordEnabled){ // I'm doing it this way instead of tacking it on above because if the value is empty it would crash the script.  The alternative is to wrap it into a try, but.. meh this is ok.
    superAdminPasswordEnabled=superAdminPasswordEnabled.toLowerCase();
  }

  // Set up the SuperAdminPassword if it's not set up already.
  if (superAdminPassword == "mypassword" || !superAdminPassword){ // "mypassword" is the default value upon install
    console.log("\nThe 'SuperAdminPassword' has not been set up yet!  This is needed for StarNet.jar to connect to the server.");
    console.log("You can set a custom alphanumeric password OR just press [ENTER] to have a long, randomized one set for you. (Recommended)")
    let newSuperAdminPassword="";
    do {
      newSuperAdminPassword=prompt("New SuperAdminPassword: ");
    }
    while (!(newSuperAdminPassword === null || newSuperAdminPassword == "" || isAlphaNumeric(newSuperAdminPassword))) // If a person puts invalid characters in, it'll just keep repeating the prompt.
    if (newSuperAdminPassword === null || newSuperAdminPassword == ""){
      console.log("Excellent choice!  I have set a VERY LONG and nearly impossible to crack SuperAdminPassword for you! :D");
      newSuperAdminPassword = getRandomAlphaNumericString(32);
    } else { console.log("Alrighty then.  I'll just use what you provided!") };
    await sleep(2000);
    serverCfg["SUPER_ADMIN_PASSWORD"]=keepIniComment(serverCfg["SUPER_ADMIN_PASSWORD"],newSuperAdminPassword);
    if (superAdminPasswordEnabled == "false") {
      console.log("Super Admin Password was disabled, enabling!");
      serverCfg["SUPER_ADMIN_PASSWORD_USE"]=keepIniComment(serverCfg["SUPER_ADMIN_PASSWORD_USE"],"true");
    }
    writeObjToIni(serverCfg,starMadeServerConfigFile);
  } else if (superAdminPasswordEnabled != "true"){ // Enable super admin password if it was disabled for some reason.
    console.log("Super Admin Password was disabled, enabling!");
    serverCfg["SUPER_ADMIN_PASSWORD_USE"]=keepIniComment(serverCfg["SUPER_ADMIN_PASSWORD_USE"],"true");
    writeObjToIni(serverCfg,starMadeServerConfigFile);
  }
  console.log("Here we go..");
  await sleep(2000);

  // ### Unimportant Async downloads/installs ### -- These should not be required by the server to run, but they may have depended on the first async install or sync installs before they could be run.

  // Start the server
  eventEmitter.emit('ready');
}
