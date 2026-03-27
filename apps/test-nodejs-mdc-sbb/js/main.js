var remoteButtons = ['btnStart', 'btnStop', 'btnClear'];
var remoteIndex = 0;

function log(message) {
  var area = document.getElementById('log');
  var time = new Date().toLocaleTimeString();
  area.textContent += '[' + time + '] ' + message + '\n';
  area.scrollTop = area.scrollHeight;
  console.log(message);
}

function setRemoteFocus(index) {
  remoteIndex = index;
  for (var i = 0; i < remoteButtons.length; i++) {
    var button = document.getElementById(remoteButtons[i]);
    if (!button) continue;
    var isFocused = i === remoteIndex;
    button.classList.toggle('remote-focus', isFocused);
    if (isFocused) button.focus();
  }
}

function moveRemoteFocus(direction) {
  var next = remoteIndex + direction;
  if (next < 0) next = remoteButtons.length - 1;
  if (next >= remoteButtons.length) next = 0;
  setRemoteFocus(next);
}

function setStatus(state, text) {
  document.getElementById('dot').className = 'dot ' + state;
  document.getElementById('statusText').textContent = text;
}

function startNode() {
  if (typeof b2bapis === 'undefined' || !b2bapis.b2bcontrol) {
    setStatus('error', 'b2bcontrol unavailable');
    log('b2bapis.b2bcontrol not available');
    return;
  }

  setStatus('starting', 'starting...');
  log('startNodeServer(lib/server.js, node-test)');

  b2bapis.b2bcontrol.startNodeServer(
    'lib/server.js',
    'node-test',
    function(result) {
      log('start success: ' + JSON.stringify(result));
      setStatus('running', 'started');
    },
    function(error) {
      log('start error: ' + JSON.stringify(error));
      setStatus('error', 'start error');
    }
  );
}

function stopNode() {
  if (typeof b2bapis === 'undefined' || !b2bapis.b2bcontrol) {
    setStatus('error', 'b2bcontrol unavailable');
    log('b2bapis.b2bcontrol not available');
    return;
  }

  b2bapis.b2bcontrol.stopNodeServer(
    function(result) {
      log('stop success: ' + JSON.stringify(result));
      setStatus('idle', 'stopped');
    },
    function(error) {
      log('stop error: ' + JSON.stringify(error));
      setStatus('error', 'stop error');
    }
  );
}

function clearLog() {
  document.getElementById('log').textContent = '';
}

document.addEventListener('keydown', function(event) {
  var code = event.keyCode || event.which;
  if (code === 37 || code === 38) {
    moveRemoteFocus(-1);
    event.preventDefault();
    return;
  }
  if (code === 39 || code === 40) {
    moveRemoteFocus(1);
    event.preventDefault();
    return;
  }
  if (code === 13) {
    var activeButton = document.getElementById(remoteButtons[remoteIndex]);
    if (activeButton) {
      activeButton.click();
      event.preventDefault();
    }
  }
});

log('ready');
log('remote enabled: arrows move focus, OK/Enter activates');
setRemoteFocus(0);