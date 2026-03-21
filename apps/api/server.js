import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/app.js";
import { JsonNoteStore } from "./src/jsonNoteStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new JsonNoteStore(path.join(__dirname, "data", "notes-db.json"));
await store.init();

const app = createApp({
  publicDir: path.join(__dirname, "..", "web"),
  store
});

const port = Number(process.env.PORT || 3000);
const server = createServer(app);

server.listen(port, () => {
  console.log(`Versioned notes app listening on http://localhost:${port}`);
});
