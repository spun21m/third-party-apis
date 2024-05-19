const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const credentials = require("./auth/credentials.json");
const [{ "api-key": NYTApiKey }, { consumer_key, redirect_uri }] = credentials;

const querystring = require("querystring");
const port = 3000;

const article_state = [];
const cache = {};
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
  } else if (req.url.startsWith("/save_articles_to_pocket")) {
    const user_selected_article = new URL(
      req.url,
      `https://${req.headers.host}`
    ).searchParams;
    const articles = user_selected_article.getAll("articles");
    if (articles.length === 0) {
      not_found(res);
      return;
    }
    const state = crypto.randomBytes(20).toString("hex");
    article_state.push({ state, articles });
    getRequestCode(state, res);
  } else if (req.url.startsWith("/receive_code")) {
    console.log("NEXT here");
    const user_received_param = new URL(req.url, `https://${req.headers.host}`)
      .searchParams;
    const code = user_received_param.get("request_token");
    const state = user_received_param.get("state");
    const user_state = article_state.find((user) => user.state === state);
    if (code === undefined || state === undefined || user_state === undefined) {
      not_found(res);
      return;
    }
    console.log("usersate", user_state.state);
    const token_cache_file = `./auth/authentication-res-${state}.json`;
    console.log(token_cache_file);
    let cache_valid = false;
    if (fs.existsSync(token_cache_file)) {
      cached_token_object = require(token_cache_file);
      if (new Date(cached_token_object.expiration) > Date.now()) {
        cache_valid = true;
      }
    }
    if (cache_valid) {
      let access_token = cached_token_object.access_token;
      saveArticleSequentially(
        0,
        access_token,
        user_state.articles,
        res,
        user_state
      );
    } else {
      send_access_token_request(code, res, user_state);
    }
  } else {
    not_found(res);
  }
}

function not_found(res) {
  res.writeHead(404, { "Content-Type": "text/html" });
  res.end(`<h1>404 Not Found </h1>`);
}

function getRequestCode(state, res) {
  const request_endpoint = "https://getpocket.com/v3/oauth/request";

  const uri = querystring.stringify({ consumer_key, redirect_uri, state });
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Accept": "application/x-www-form-urlencoded",
    },
  };

  https
    .request(request_endpoint, options, (stream) =>
      process_stream(stream, redirect_to_pocket, state, res)
    )
    .end(uri);
}

function redirect_to_pocket(body, state, res) {
  const authorization_endpoint = `https://getpocket.com/auth/authorize`;
  const { code: request_token } = querystring.parse(body);

  const uri = querystring.stringify({
    request_token,
    redirect_uri: `http://localhost:3000/receive_code?request_token=${request_token}&state=${state}`,
  });
  res.writeHead(302, { Location: `${authorization_endpoint}?${uri}` }).end();
}

function send_access_token_request(code, res, user_state) {
  const token_endpoint = "https://getpocket.com/v3/oauth/authorize";

  const uri = querystring.stringify({ consumer_key, code });
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Accept": "application/x-www-form-urlencoded",
    },
  };
  const token_request_time = new Date();

  https
    .request(token_endpoint, options, (access_token_res_stream) =>
      process_stream(
        access_token_res_stream,
        receive_access_token,
        token_request_time,
        res,
        user_state
      )
    )
    .end(uri);
}

function receive_access_token(body, token_request_time, res, user_state) {
  const token_object = querystring.parse(body);
  const access_token = token_object.access_token;
  user_state.username = token_object.username;
  create_access_token_cache(token_object, token_request_time, user_state.state);
  saveArticleSequentially(
    0,
    access_token,
    user_state.articles,
    res,
    user_state
  );
}

function create_access_token_cache(parsedData, token_request_time, user_id) {
  parsedData.expiration = new Date(
    token_request_time.getTime() + 3600 * 1000
  ).toLocaleString();
  fs.writeFile(
    `./auth/authentication-res-${user_id}.json`,
    JSON.stringify(parsedData),
    () => console.log("Access Token Cached")
  );
}

function saveArticleSequentially(
  index,
  access_token,
  articles,
  res,
  user_state
) {
  if (index < articles.length) {
    const article = articles[index];
    send_add_article_request(access_token, article, () => {
      saveArticleSequentially(
        index + 1,
        access_token,
        articles,
        res,
        user_state
      );
    });
  } else {
    res
      .writeHead(302, { Location: "https://getpocket.com/saves?src=navbar" })
      .end();
  }
}

function send_add_article_request(access_token, url, callback) {
  // console.log(`url ${url}`);
  const add_article_endpoint = "https://getpocket.com/v3/add";
  const uri = JSON.stringify({
    consumer_key,
    access_token,
    url,
  });
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Accept": "application/json",
    },
  };
  https
    .request(add_article_endpoint, options, (articleResponseStream) =>
      process_stream(articleResponseStream, callback)
    )
    .end(uri);
  // request.end(uri);
}

function redirect_to_nyt(article, res) {
  console.log("Searching for article:", article);
  const article_endpoint = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${article}&api-key=${NYTApiKey}`;
  if (cache[article]) {
    console.log("cached");
    serve_results(cache[article], article, res);
  } else {
    const options = {
      method: "GET",
    };
    https
      .request(article_endpoint, options, (stream) =>
        process_stream(stream, (body) => {
          cache[article] = body;
          serve_results(body, article, res);
        })
      )
      .end();
  }
}

function process_stream(stream, callback, ...args) {
  let body = "";
  stream.on("data", (chunk) => (body += chunk));
  stream.on("end", () => callback(body, ...args));
}

function serve_results(body, article, res) {
  let articles_obj = JSON.parse(body);
  let articles = articles_obj.response.docs;
  let articleUrls = articles.slice(0, 5).map((article) => {
    return { title: article.headline.main, url: article.web_url };
  });
  let html = `<h2>Search Results for article related to ${article}: </h2><form id="saveForm" action="/save_articles_to_pocket"><ul style ="list-style:none;">`;
  articleUrls.forEach((article, index) => {
    html += `<li><input type="checkbox" id="article${index}" name="articles" value="${article.url}"> <label for="articles${index}"><a href="${article.url}" target="_blank">${article.title}</a></label></li>`;
  });
  if (articleUrls.length > 0) {
    html += `</ul><button type="submit">Save Selected Articles</button></form>`;
  } else {
    html += `<p> No articles found related to "${article}".</p>`;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.write(`<div id="searchResults">${html}</div`);
  res.end();
}
