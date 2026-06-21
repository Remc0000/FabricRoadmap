const { TableClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");

const PARTITION_KEY = "global";
const COUNTER_ROW_KEY = "counter";
const SESSION_PREFIX = "session:";

const accountName = process.env.COUNTER_STORAGE_ACCOUNT;
const tableName = process.env.COUNTER_TABLE_NAME || "visitorSessions";

if (!accountName) {
  throw new Error("COUNTER_STORAGE_ACCOUNT is required");
}

const serviceUrl = `https://${accountName}.table.core.windows.net`;
const credential = new DefaultAzureCredential();
const tableClient = new TableClient(serviceUrl, tableName, credential);
let tableReadyPromise;

const now = () => new Date().toISOString();

const isMissing = (error) => error && (error.statusCode === 404 || error.code === "ResourceNotFound");
const isConflict = (error) => error && (error.statusCode === 409 || error.code === "EntityAlreadyExists");
const isPrecondition = (error) => error && (error.statusCode === 412 || error.code === "UpdateConditionNotSatisfied");

const normalizeIp = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0].trim();
  const bracketMatch = first.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) return bracketMatch[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(first)) return first.replace(/:\d+$/, "");
  return first;
};

const getClientIp = (req) =>
  normalizeIp(
    req.headers["x-forwarded-for"] ||
    req.headers["x-arr-clientip"] ||
    req.headers["x-client-ip"] ||
    req.headers["x-real-ip"] ||
    ""
  );

async function ensureTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = tableClient.createTable().catch((error) => {
      if (isConflict(error)) return;
      throw error;
    });
  }
  return tableReadyPromise;
}

async function getEntity(partitionKey, rowKey) {
  try {
    return await tableClient.getEntity(partitionKey, rowKey);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function getCounterRow() {
  const entity = await getEntity(PARTITION_KEY, COUNTER_ROW_KEY);
  if (entity) return entity;

  const seed = {
    partitionKey: PARTITION_KEY,
    rowKey: COUNTER_ROW_KEY,
    total: 0,
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await tableClient.createEntity(seed);
    return seed;
  } catch (error) {
    if (!isConflict(error)) throw error;
    return await getEntity(PARTITION_KEY, COUNTER_ROW_KEY);
  }
}

async function recordSession(sessionId, headers) {
  const rowKey = `${SESSION_PREFIX}${sessionId}`;
  const clientIp = getClientIp({ headers: headers || {} });
  let sessionCreated = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!sessionCreated) {
      try {
        await tableClient.createEntity({
          partitionKey: PARTITION_KEY,
          rowKey,
          sessionId,
          ipAddress: clientIp || null,
          createdAt: now(),
        });
        sessionCreated = true;
      } catch (error) {
        if (isConflict(error)) {
          const counter = await getCounterRow();
          return Number(counter.total || 0);
        }
        throw error;
      }
    }

    const counter = await getCounterRow();
    const nextTotal = Number(counter.total || 0) + 1;
    const counterEntity = {
      partitionKey: PARTITION_KEY,
      rowKey: COUNTER_ROW_KEY,
      total: nextTotal,
      updatedAt: now(),
    };

    try {
      await tableClient.updateEntity(counterEntity, "Replace", { etag: counter.etag || "*" });
      return nextTotal;
    } catch (error) {
      if (isConflict(error) || isPrecondition(error)) continue;
      throw error;
    }
  }

  throw new Error("Failed to record session after retries");
}

module.exports = async function (context, req) {
  const requestHeaders = req.headers || {};
  const origin = requestHeaders.origin;
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }

  try {
    await ensureTable();

    if (req.method === "OPTIONS") {
      context.res = { status: 204, headers };
      return;
    }

    if (req.method === "GET") {
      const counter = await getCounterRow();
      context.res = {
        status: 200,
        headers,
        body: { total: Number(counter.total || 0) },
      };
      return;
    }

    const sessionId = String(req.query.sessionId || (req.body && req.body.sessionId) || "").trim();
    if (!sessionId) {
      context.res = {
        status: 400,
        headers,
        body: { error: "sessionId is required" },
      };
      return;
    }

    const total = await recordSession(sessionId, requestHeaders);
    context.res = {
      status: 200,
      headers,
      body: { total },
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      headers,
      body: {
        error: error.message,
        code: error.code || null,
        statusCode: error.statusCode || null,
      },
    };
  }
};
