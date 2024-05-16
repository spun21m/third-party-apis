const http = require("http");
const port = 3000;
const server = http.createServer();

server.on("request", connection_handler);
function connection_handler(req, res) {
  console.log(`New Request for ${req.url} from ${req.socket.remoteAddress}`);
}

server.on("listening", listening_hnadler);
function listening_hnadler() {
  console.log(`Now listening on Port ${port}`);
}

server.listen(port);
