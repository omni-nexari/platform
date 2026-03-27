var http = require('http');

http.createServer(function(req, res) {
  res.write(' It works!');
  res.end();
}).listen(8080, '0.0.0.0');