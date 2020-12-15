var http = require('http');
var app = require('./app');

var port = require('./config').port;

var server = http.createServer(app);

server.listen(port);