// Anomaly Engine — "E" in MERN
// Express (Node) microservice: thin, read-only HTTP surface over MongoDB.
// Serves the raw SEC filing documents that ingestion-us already persisted
// into anomaly_engine.raw_filings (born directly from the Mongo seed).
//
// Additive by design: this service only READS MongoDB. It never writes and it
// never touches Supabase / the Python core. Kill it and nothing else changes.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config({ path: process.env.ENV_FILE ?? new URL("../../.env", import.meta.url).pathname });

const PORT = Number(process.env.MONGO_API_PORT ?? 8081);
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/anomaly_engine";
const DB_NAME = (MONGODB_URI.split("/").pop() || "anomaly_engine").split("?")[0];

const app = express();
app.use(cors());
app.use(express.json());

let db = null;
let client = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

app.get("/health", async (_req, res) => {
  try {
    const d = await connect();
    await d.command({ ping: 1 });
    res.json({
      status: "ok",
      service: "mongo-api (Express)",
      mongodb: "connected",
      db: DB_NAME,
      collections: (await d.listCollections().toArray()).map((c) => c.name),
    });
  } catch (e) {
    res.status(503).json({ status: "degraded", service: "mongo-api (Express)", mongodb: `error: ${e.message}` });
  }
});

app.get("/api/v1/raw/filings", async (req, res, next) => {
  try {
    const d = await connect();
    const ticker = String(req.query.ticker ?? "AAPL").toUpperCase();
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const docs = await d
      .collection("raw_filings")
      .find({ ticker })
      .sort({ accession: -1 })
      .limit(limit)
      .project({ _id: 1, ticker: 1, accession: 1, filing_date: 1, document: 1, size_bytes: 1, source_url: 1, status: 1 })
      .toArray();
    res.json({ count: docs.length, ticker, filings: docs.map(({ _id, ...f }) => ({ id: String(_id), ...f })) });
  } catch (e) {
    next(e);
  }
});

app.get("/api/v1/raw/stats", async (_req, res, next) => {
  try {
    const d = await connect();
    res.json({
      total_filings: await d.collection("raw_filings").countDocuments({}),
      by_status: await d.collection("raw_filings").aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
      collection_names: (await d.listCollections().toArray()).map((c) => c.name),
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/v1/raw/filings/:id", async (req, res, next) => {
  try {
    const d = await connect();
    let doc = null;
    try {
      doc = await d.collection("raw_filings").findOne({ _id: new ObjectId(req.params.id) });
    } catch {
      doc = await d.collection("raw_filings").findOne({ accession: req.params.id });
    }
    if (!doc) return res.status(404).json({ error: "not found" });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error("[mongo-api] error:", err.message);
  res.status(err.status || 500).json({ error: err.message });
});

async function main() {
  await connect();
  app.listen(PORT, () => console.log(`[mongo-api] Express on http://127.0.0.1:${PORT} (mongo: ${DB_NAME})`));
}

main().catch((e) => {
  console.error("[mongo-api] fatal:", e.message);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await client?.close().catch(() => {});
  process.exit(0);
});
