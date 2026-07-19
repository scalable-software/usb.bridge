import express from "express";

const PORT = Number(process.env.PORT ?? 3030);
const ROOT = import.meta.dirname;

// Static file host for local development. Web Serial requires a secure
// context; http://localhost qualifies, so no TLS is needed here.
class Server {
  #app;

  constructor(root) {
    this.#app = express();
    this.#app.use((req, res, next) => this.#log(req, res, next));
    this.#app.use(express.static(root));
  }

  listen(port, onReady) {
    this.#app.listen(port, onReady);
  }

  #log(req, res, next) {
    res.on("finish", () => console.log(`${res.statusCode} ${req.method} ${req.path}`));
    next();
  }
}

new Server(ROOT).listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});
