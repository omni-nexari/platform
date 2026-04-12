# Tizen Node.js How-To

This guide captures the working setup for launching a Node.js process from a Samsung SBB or SSSP Tizen widget using `b2bapis.b2bcontrol.startNodeServer()`.

It is based on the working test app in `apps/test-nodejs-mdc-sbb` and the signed sample in `Docs/sample/TestNode`.

## Scope

- Target platform: Samsung SBB / SSSP Tizen signage devices
- Widget type: Tizen web application (`.wgt`)
- Node launch API: `b2bapis.b2bcontrol.startNodeServer()`
- Verified health check: `http://<device-ip>:3000/`

## Known Working Layout

Use this app structure:

```text
app-root/
  config.xml
  index.html
  icon.png
  server.js
  css/
    style.css
  js/
    main.js
```

The important detail is the combination of these two facts:

1. `main.js` lives in `js/`
2. The Node entry file lives at the app root as `server.js`

Because of that, the launch path used from `js/main.js` must be:

```js
'../server.js'
```

## Required Privileges

The working test app uses these privileges in `config.xml`:

```xml
<tizen:privilege name="http://tizen.org/privilege/internet"/>
<tizen:privilege name="http://tizen.org/privilege/filesystem.read"/>
<tizen:privilege name="http://tizen.org/privilege/application.launch"/>
<tizen:privilege name="http://developer.samsung.com/privilege/was.partner"/>
<tizen:privilege name="http://developer.samsung.com/privilege/b2bcontrol"/>
```

The current working app also uses:

```xml
<tizen:metadata key="http://samsung.com/tv/metadata/use.network" value="true"/>
<tizen:metadata key="http://samsung.com/tv/metadata/prelaunch.support" value="true"/>
```

## Minimal Launcher

In `js/main.js`, start Node like this:

```js
b2bapis.b2bcontrol.startNodeServer(
  '../server.js',
  'node-test',
  function(result) {
    console.log('start success: ' + JSON.stringify(result));
  },
  function(error) {
    console.log('start error: ' + JSON.stringify(error));
  }
);
```

Notes:

- The success callback may log `undefined`. That can still be a valid successful launch on device.
- Do not treat `undefined` in the success callback as a failure by itself.

## Minimal Node Server

The working `server.js` is:

```js
var http = require('http');

http.createServer(function(req, res) {
  res.writeHead(200, {'Content-Type': 'text/html'});

  if (req.url === '/') {
    res.write('<html><body><h1>Hello World</h1></body></html>');
  } else {
    res.write('<html><body><h1>404 - Page Not Found</h1></body></html>');
  }

  res.end();
}).listen(3000, function() {
  console.log('Server running at 3000');
});
```

Important details:

- Port `3000` is the verified working port in our test.
- A simple callback form of `listen(3000, callback)` matched the signed sample behavior.
- We did not need a separate `/health` route. Root `/` was enough.

## Health Check

After installing the widget on the display and pressing `Start Node`, test from your dev machine:

```powershell
Invoke-WebRequest http://<device-ip>:3000/
```

Expected response:

```html
<html><body><h1>Hello World</h1></body></html>
```

Example:

```powershell
Invoke-WebRequest http://192.168.1.39:3000/
```

## Verification Flow

1. Build and sign the widget.
2. Install the `.wgt` on the Samsung device.
3. Launch the widget on the screen.
4. Press `Start Node` in the app UI.
5. From the dev PC, request `http://<device-ip>:3000/`.
6. Confirm HTTP `200 OK` and the `Hello World` body.

## Common Failure Modes

### `ERR_CONNECTION_REFUSED`

Check these first:

- The widget currently installed on the device is the latest rebuilt package.
- The app was launched and `Start Node` was pressed.
- `startNodeServer()` is using `../server.js`, not `server.js` or `lib/server.js`.
- `server.js` exists at the widget root.
- The server is listening on `3000`.
- The device IP is correct and reachable from the dev PC.

### Success callback fires but port is closed

This usually means one of these is wrong:

- Node file path is wrong relative to `js/main.js`
- The installed widget is stale
- The runtime did not actually load the expected `server.js`

### UI label vs actual launch path

The text shown in the HTML input is only a display label. The real launch path is whatever is passed to `startNodeServer()` in `js/main.js`.

## Signed Sample Reference

The matching signed sample is here:

- `Docs/sample/TestNode`

That sample helped confirm two critical points:

1. The launcher path from `js/main.js` should be `../server.js` style
2. The simple Node HTTP server should listen on port `3000`

## Repo Reference

Current working test app:

- `apps/test-nodejs-mdc-sbb`

Key files:

- `apps/test-nodejs-mdc-sbb/js/main.js`
- `apps/test-nodejs-mdc-sbb/server.js`
- `apps/test-nodejs-mdc-sbb/config.xml`
- `apps/test-nodejs-mdc-sbb/index.html`