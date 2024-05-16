const fs = require("fs");
const http = require("http");
const https = require("https");
const credentials = require("./auth/credentials.json");
const NYTApiKey = credentials["api-key"];
const port = 3000;
const server = http.createServer();

server.on("listening", listen_handler);
server.listen(port);
function listen_handler() {
  console.log(`Now listening on Port ${port}`);
}

server.on("request", connection_handler);
function connection_handler(req, res) {
  console.log(`New Request for ${req.url} from ${req.socket.remoteAddress}`);
  if (req.url === "/") {
    const form = fs.createReadStream("./index.html");
    res.writeHead(200, { "content-Type": "text/html" });
    form.pipe(res);
  } else if (req.url.startsWith("/search_article")) {
    const user_input = new URL(req.url, `https://${req.headers.host}`)
      .searchParams;
    const article = user_input.get("article");
    if (article == null || article == "") {
      not_found(res);
      return;
    }
    redirect_to_nyt(article, res);
  }
}

function not_found(res) {
  res.writeHead(404, { "Content-Type": "text/html" });
  res.end(`<h1>404 Not Found </h1>`);
}

function redirect_to_nyt(article, res) {
  const article_endpoint = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${article}&api-key=${NYTApiKey}`;
  const article_request = https.get(article_endpoint, {
    method: "GET",
  });
  article_request.once("response", process_stream);
  function process_stream(article_stream) {
    let article_data = "";
    article_stream.on("data", (chunk) => (article_data += chunk));
    article_stream.on("end", () => serve_results(article_data, article, res));
  }
}

function serve_results(article_data, article, res) {
  let articles_obj = JSON.parse(article_data);
  let articles = articles_obj.response.docs;
  let articleUrls = articles.slice(0, 5).map((article) => article.web_url);
  let html = `<h2>Search Results for article related to ${article}: </h2><form id="saveForm" action="/save_articles_to_pocket"><ul>`;
  articleUrls.forEach((url, index) => {
    html += `<li><input type="checkbox" id="article${index}" name="articles" value="${url}"> <label for="articles${index}">${url}</label></li>`;
  });
  if (articleUrls.length > 0) {
    html += `</ul><button type="submit">Save Selected Articles</button></form>`;
  } else {
    html += `<p> No articles found related to "${articles}".</p>`;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.write(`<div id="searchResults">${html}</div`);
  res.end();
}
