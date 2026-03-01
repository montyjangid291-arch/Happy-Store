const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const webpush = require("web-push");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const defaultStock = {
  Maggi: 24,
  Kurkure: 9,
  Bhujia: 2,
  Namkeen: 2,
  "Bhoot Chips": 5,
  "Onion Chips": 5,
  "Unibic Chocolate Chip Cookies": 5,
};

const defaultBuyPrice = {
  Maggi: 0,
  Kurkure: 0,
  Bhujia: 0,
  Namkeen: 0,
  "Bhoot Chips": 0,
  "Onion Chips": 0,
  "Unibic Chocolate Chip Cookies": 0,
};

const defaultSellPrice = {
  Maggi: 20,
  Kurkure: 20,
  Bhujia: 300,
  Namkeen: 50,
  "Bhoot Chips": 20,
  "Onion Chips": 30,
  "Unibic Chocolate Chip Cookies": 30,
};

const defaultManualCustomers = {
  monthly: {},
  lifetime: {},
};

function getDefaultProductMap(fillValue) {
  return {
    Maggi: fillValue,
    Kurkure: fillValue,
    Bhujia: fillValue,
    Namkeen: fillValue,
    "Bhoot Chips": fillValue,
    "Onion Chips": fillValue,
    "Unibic Chocolate Chip Cookies": fillValue,
  };
}

const defaultDistributorStock = {
  "104": getDefaultProductMap(0),
  "407": getDefaultProductMap(0),
  "607": getDefaultProductMap(0),
};

function normalizeDistributorStock(raw) {
  const result = {
    "104": getDefaultProductMap(0),
    "407": getDefaultProductMap(0),
    "607": getDefaultProductMap(0),
  };
  if (!raw || typeof raw !== "object") return result;
  ["104", "407", "607"].forEach((room) => {
    const source = raw[room];
    if (!source || typeof source !== "object") return;
    Object.keys(result[room]).forEach((name) => {
      result[room][name] = Number(source[name]) || 0;
    });
  });
  return result;
}

function normalizeManualCustomers(raw) {
  const result = { monthly: {}, lifetime: {} };
  if (!raw || typeof raw !== "object") return result;

  const monthly = raw.monthly && typeof raw.monthly === "object" ? raw.monthly : {};
  Object.keys(monthly).forEach((month) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const monthBucket = monthly[month];
    if (!monthBucket || typeof monthBucket !== "object") return;
    result.monthly[month] = {};
    Object.keys(monthBucket).forEach((key) => {
      const entry = monthBucket[key];
      if (!entry || typeof entry !== "object") return;
      const name = String(entry.name || "").trim();
      const room = String(entry.room || "").trim();
      if (!name || !room) return;
      result.monthly[month][buildCustomerKey(name, room)] = {
        name,
        room,
        totalSpent: Math.max(0, Number(entry.totalSpent) || 0),
        ordersCount: Math.max(0, Number(entry.ordersCount) || 0),
      };
    });
  });

  const lifetime = raw.lifetime && typeof raw.lifetime === "object" ? raw.lifetime : {};
  Object.keys(lifetime).forEach((key) => {
    const entry = lifetime[key];
    if (!entry || typeof entry !== "object") return;
    const name = String(entry.name || "").trim();
    const room = String(entry.room || "").trim();
    if (!name || !room) return;
    result.lifetime[buildCustomerKey(name, room)] = {
      name,
      room,
      totalSpent: Math.max(0, Number(entry.totalSpent) || 0),
      ordersCount: Math.max(0, Number(entry.ordersCount) || 0),
    };
  });

  return result;
}

const StoreStateSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, required: true, unique: true, default: "main" },
    storeStock: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultStock }) },
    orders: { type: [mongoose.Schema.Types.Mixed], default: [] },
    pushSubscriptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    manualCustomers: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultManualCustomers }) },
    buyPrice: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultBuyPrice }) },
    sellPrice: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultSellPrice }) },
    distributorStock: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultDistributorStock }) },
    storeClosed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const StoreState = mongoose.model("StoreState", StoreStateSchema);

let storeStock = { ...defaultStock };
let orders = [];
let pushSubscriptions = [];
let manualCustomers = normalizeManualCustomers(defaultManualCustomers);
let buyPrice = { ...defaultBuyPrice };
let sellPrice = { ...defaultSellPrice };
let distributorStock = normalizeDistributorStock(defaultDistributorStock);
let storeClosed = false;
let initPromise = null;

function mergeProductMap(baseMap, incomingMap, fallbackValue = 0) {
  const out = { ...baseMap };
  const src = incomingMap && typeof incomingMap === "object" ? incomingMap : {};
  Object.keys(baseMap).forEach((name) => {
    if (src[name] !== undefined) {
      const n = Number(src[name]);
      out[name] = Number.isFinite(n) ? n : fallbackValue;
    }
  });
  return out;
}

function saveData() {
  StoreState.findOneAndUpdate(
    { singletonKey: "main" },
    {
      singletonKey: "main",
      storeStock,
      orders,
      pushSubscriptions,
      manualCustomers,
      buyPrice,
      sellPrice,
      distributorStock,
      storeClosed,
    },
    { upsert: true, setDefaultsOnInsert: true, new: true }
  ).catch((err) => {
    console.error("MongoDB save failed:", err);
  });
}

async function loadStateFromMongo() {
  const doc = await StoreState.findOne({ singletonKey: "main" }).lean();
  if (!doc) {
    await StoreState.create({
      singletonKey: "main",
      storeStock,
      orders,
      pushSubscriptions,
      manualCustomers,
      buyPrice,
      sellPrice,
      distributorStock,
      storeClosed,
    });
    return;
  }

  storeStock = mergeProductMap(defaultStock, doc.storeStock, 0);
  orders = Array.isArray(doc.orders) ? doc.orders : [];
  pushSubscriptions = normalizePushSubscriptions(doc.pushSubscriptions);
  manualCustomers = normalizeManualCustomers(doc.manualCustomers);
  buyPrice = mergeProductMap(defaultBuyPrice, doc.buyPrice, 0);
  sellPrice = mergeProductMap(defaultSellPrice, doc.sellPrice, 0);
  distributorStock = normalizeDistributorStock(doc.distributorStock);
  storeClosed = !!doc.storeClosed;
}

async function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI is missing. Set it in environment before starting server.");
    }
    await mongoose.connect(mongoUri);
    console.log("MongoDB Connected");
    await loadStateFromMongo();
  })();
  return initPromise;
}

app.use(async (req, res, next) => {
  try {
    await initDatabase();
    next();
  } catch (err) {
    console.error("Database init failed:", err);
    res.status(500).json({ status: "error", message: "Database unavailable" });
  }
});
const RESET_CUSTOMER_PASSWORD = process.env.RESET_CUSTOMER_PASSWORD || "291";
const PRICE_UPDATE_PASSWORD = process.env.PRICE_UPDATE_PASSWORD || "291";
const RESET_PROFIT_PASSWORD = process.env.RESET_PROFIT_PASSWORD || "291";
const WEB_PUSH_PUBLIC_KEY = String(
  process.env.WEB_PUSH_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || ""
).trim();
const WEB_PUSH_PRIVATE_KEY = String(
  process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || ""
).trim();
const WEB_PUSH_CONTACT = String(
  process.env.WEB_PUSH_CONTACT || "mailto:admin@montymart.local"
).trim();

let webPushEnabled = false;
if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(WEB_PUSH_CONTACT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
  webPushEnabled = true;
} else {
  console.warn("Web push disabled: WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY missing.");
}

function normalizePushSubscriptions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((entry) => {
    const endpoint = String(entry?.endpoint || "").trim();
    const keys = entry?.keys && typeof entry.keys === "object" ? entry.keys : {};
    const p256dh = String(keys.p256dh || "").trim();
    const auth = String(keys.auth || "").trim();
    if (!endpoint || !p256dh || !auth) return;
    if (seen.has(endpoint)) return;
    seen.add(endpoint);
    out.push({
      endpoint,
      keys: { p256dh, auth },
      createdAt: entry?.createdAt || new Date().toISOString(),
      userAgent: String(entry?.userAgent || "").slice(0, 400),
      deviceId: String(entry?.deviceId || "").slice(0, 100),
    });
  });
  return out;
}

function upsertPushSubscription(subscription, meta = {}) {
  const normalizedList = normalizePushSubscriptions([subscription]);
  if (!normalizedList.length) return false;
  const incoming = normalizedList[0];
  incoming.userAgent = String(meta.userAgent || incoming.userAgent || "").slice(0, 400);
  incoming.deviceId = String(meta.deviceId || incoming.deviceId || "").slice(0, 100);

  const index = pushSubscriptions.findIndex((s) => s.endpoint === incoming.endpoint);
  if (index >= 0) {
    pushSubscriptions[index] = { ...pushSubscriptions[index], ...incoming };
  } else {
    pushSubscriptions.push(incoming);
  }
  saveData();
  return true;
}

function removePushSubscriptionByEndpoint(endpointRaw) {
  const endpoint = String(endpointRaw || "").trim();
  if (!endpoint) return false;
  const before = pushSubscriptions.length;
  pushSubscriptions = pushSubscriptions.filter((s) => String(s.endpoint || "").trim() !== endpoint);
  if (pushSubscriptions.length !== before) {
    saveData();
    return true;
  }
  return false;
}

async function sendOrderPushNotification(order) {
  if (!webPushEnabled || !pushSubscriptions.length) return;

  const payload = JSON.stringify({
    title: "New Monty Mart Order",
    body: `${String(order?.name || "Customer")} (Room ${String(order?.room || "-")}) - Rs ${Number(order?.total) || 0}`,
    orderId: Number(order?.id) || 0,
    url: "/",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
  });

  const failedEndpoints = [];
  await Promise.all(
    pushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        const statusCode = Number(err?.statusCode) || 0;
        if (statusCode === 404 || statusCode === 410) {
          failedEndpoints.push(sub.endpoint);
        }
      }
    })
  );

  if (failedEndpoints.length) {
    const stale = new Set(failedEndpoints);
    pushSubscriptions = pushSubscriptions.filter((s) => !stale.has(s.endpoint));
    saveData();
  }
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getOrderDate(order) {
  if (order.createdAt) {
    const dt = new Date(order.createdAt);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const fallback = new Date(order.time);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCustomerKey(nameRaw, roomRaw) {
  const name = String(nameRaw || "").trim().toLowerCase();
  const room = String(roomRaw || "").trim();
  return `${name}|${room}`;
}

function applyMonthlyManualCustomers(spendMap, month) {
  const monthlyBucket =
    manualCustomers &&
    manualCustomers.monthly &&
    typeof manualCustomers.monthly === "object"
      ? manualCustomers.monthly[month]
      : null;
  if (!monthlyBucket || typeof monthlyBucket !== "object") return;

  Object.keys(monthlyBucket).forEach((key) => {
    const row = monthlyBucket[key];
    if (!row) return;
    spendMap[key] = {
      name: String(row.name || "").trim() || "Unknown",
      room: String(row.room || "").trim() || "-",
      totalSpent: Math.max(0, Number(row.totalSpent) || 0),
      ordersCount: Math.max(0, Number(row.ordersCount) || 0),
    };
  });
}

function applyLifetimeManualCustomers(spendMap) {
  const lifetimeBucket =
    manualCustomers &&
    manualCustomers.lifetime &&
    typeof manualCustomers.lifetime === "object"
      ? manualCustomers.lifetime
      : null;
  if (!lifetimeBucket || typeof lifetimeBucket !== "object") return;

  Object.keys(lifetimeBucket).forEach((key) => {
    const row = lifetimeBucket[key];
    if (!row) return;
    spendMap[key] = {
      name: String(row.name || "").trim() || "Unknown",
      room: String(row.room || "").trim() || "-",
      totalSpent: Math.max(0, Number(row.totalSpent) || 0),
      ordersCount: Math.max(0, Number(row.ordersCount) || 0),
    };
  });
}

function isOrderCancelled(order) {
  return order && order.status === "cancelled";
}

function isOrderExcludedFromCustomerStats(order) {
  return order && order.excludeFromCustomerStats === true;
}

function isOrderExcludedFromProfitStats(order) {
  return order && order.excludeFromProfitStats === true;
}

function normalizePricePayload(body) {
  if (!body || typeof body !== "object") return null;
  if (body.prices && typeof body.prices === "object") return body.prices;
  return body;
}

function calculateOrderProfit(order) {
  if (!order || !Array.isArray(order.items)) return 0;
  let profit = 0;
  order.items.forEach((item) => {
    const qty = Number(item.qty) || 0;
    const sellAtOrder = Number(
      item.sellPriceAtOrder !== undefined ? item.sellPriceAtOrder : item.price
    ) || 0;
    const buyAtOrder = Number(
      item.buyPriceAtOrder !== undefined ? item.buyPriceAtOrder : buyPrice[item.name]
    ) || 0;
    profit += (sellAtOrder - buyAtOrder) * qty;
  });
  return profit;
}

function recalculateOrderTotals(order) {
  if (!order || !Array.isArray(order.items)) return;
  let itemsSubTotal = 0;
  order.items.forEach((item) => {
    const qty = Number(item.qty) || 0;
    const sellAtOrder = Number(
      item.sellPriceAtOrder !== undefined ? item.sellPriceAtOrder : item.price
    ) || 0;
    itemsSubTotal += sellAtOrder * qty;
  });
  const mode = String(order.mode || "").toLowerCase().trim();
  const deliveryCharge = mode === "delivery" ? 10 : 0;
  order.deliveryCharge = deliveryCharge;
  order.total = itemsSubTotal + (order.items.length ? deliveryCharge : 0);
  order.profit = calculateOrderProfit(order);
}

function getDistributorRoomByCustomerRoom(roomNoRaw) {
  const roomNo = Number(roomNoRaw);
  if (!Number.isFinite(roomNo)) return "607";
  if (roomNo >= 0 && roomNo <= 299) return "104";
  if (roomNo >= 300 && roomNo <= 599) return "407";
  return "607";
}

function backfillLegacyOrderProfitData() {
  let changed = false;
  orders.forEach((order) => {
    if (!order || !Array.isArray(order.items)) return;
    order.items.forEach((item) => {
      if (item.sellPriceAtOrder === undefined) {
        item.sellPriceAtOrder = Number(item.price) || 0;
        changed = true;
      }
      if (item.buyPriceAtOrder === undefined) {
        item.buyPriceAtOrder = Number(buyPrice[item.name]) || 0;
        changed = true;
      }
    });
    if (!Number.isFinite(Number(order.profit))) {
      order.profit = calculateOrderProfit(order);
      changed = true;
    }
  });
  if (changed) saveData();
}

backfillLegacyOrderProfitData();

app.get("/stock", (req, res) => {
  res.json(storeStock);
});

app.get("/push/public-key", (req, res) => {
  if (!webPushEnabled) {
    return res.status(503).json({ status: "disabled", message: "Push notifications are not configured." });
  }
  return res.json({ status: "ok", publicKey: WEB_PUSH_PUBLIC_KEY });
});

app.post("/push/subscribe", (req, res) => {
  if (!webPushEnabled) {
    return res.status(503).json({ status: "disabled", message: "Push notifications are not configured." });
  }
  const subscription = req.body?.subscription || req.body;
  const saved = upsertPushSubscription(subscription, {
    userAgent: req.headers["user-agent"] || "",
    deviceId: req.body?.deviceId || "",
  });
  if (!saved) {
    return res.status(400).json({ status: "error", message: "Invalid push subscription payload." });
  }
  return res.json({ status: "subscribed" });
});

app.post("/push/unsubscribe", (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) {
    return res.status(400).json({ status: "error", message: "Endpoint is required." });
  }
  removePushSubscriptionByEndpoint(endpoint);
  return res.json({ status: "unsubscribed" });
});

app.post("/stock", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid stock" });
  }

  storeStock = req.body;
  saveData();
  console.log("Stock Updated:", storeStock);
  res.json({ status: "saved" });
});

app.post("/order", async (req, res) => {
  const order = req.body;

  if (!order || !Array.isArray(order.items)) {
    return res.status(400).json({ status: "error", message: "Invalid order" });
  }

  let itemsSubTotal = 0;
  const distributorRoom = getDistributorRoomByCustomerRoom(order.room);
  if (!distributorStock[distributorRoom]) {
    distributorStock[distributorRoom] = getDefaultProductMap(0);
  }
  order.items.forEach((i) => {
    const itemName = String(i.name || "").trim();
    const qty = Number(i.qty) || 0;
    const sellAtOrder = Number(sellPrice[itemName] !== undefined ? sellPrice[itemName] : i.price) || 0;
    const buyAtOrder = Number(buyPrice[itemName]) || 0;
    i.price = sellAtOrder;
    i.qty = qty;
    i.sellPriceAtOrder = sellAtOrder;
    i.buyPriceAtOrder = buyAtOrder;
    itemsSubTotal += sellAtOrder * qty;
    if (storeStock[i.name] !== undefined) {
      storeStock[i.name] -= i.qty;
    }
    if (distributorStock[distributorRoom][i.name] === undefined) {
      distributorStock[distributorRoom][i.name] = 0;
    }
    distributorStock[distributorRoom][i.name] -= i.qty;
  });
  const normalizedMode = String(order.mode || "").toLowerCase().trim() === "delivery" ? "delivery" : "pickup";
  order.mode = normalizedMode;
  const deliveryCharge = normalizedMode === "delivery" ? 10 : 0;
  order.deliveryCharge = deliveryCharge;
  order.total = itemsSubTotal + deliveryCharge;

  order.id = Date.now();
  order.time = new Date().toLocaleString();
  order.createdAt = new Date().toISOString();
  order.status = "active";
  order.cancelledAt = null;
  if (!order.deliveryType) {
    order.deliveryType = order.mode === "pickup" ? "Self Pickup" : "Room Delivery";
  }
  order.collectFromRoom = String(order.collectFromRoom || distributorRoom);
  order.profit = calculateOrderProfit(order);

  const deliveryText =
    order.mode === "pickup"
      ? "SELF PICKUP"
      : `ROOM DELIVERY (₹${order.deliveryCharge})`;

  orders.push(order);
  saveData();

  console.log("\n====== NEW ORDER ======");
  console.log("Order ID:", order.id);
  console.log("Name:", order.name);
  console.log("Room:", order.room);
  console.log("Hostel:", order.hostel);
  console.log("Type:", deliveryText);
  console.log("Items:");

  order.items.forEach((i) => {
    console.log(` - ${i.name} x${i.qty} = ₹${i.price * i.qty}`);
  });

  console.log("TOTAL: ₹" + order.total);
  console.log("Time:", order.time);
  console.log("=======================\n");

  sendOrderPushNotification(order).catch((err) => {
    console.error("Push send failed:", err?.message || err);
  });

  res.json({ status: "ok", orderId: order.id, cancelWindowMs: 120000 });
});

app.get("/buy-price", (req, res) => {
  res.json(buyPrice);
});

app.post("/buy-price", (req, res) => {
  const password = String(req.body?.password || "");
  if (password !== PRICE_UPDATE_PASSWORD) {
    return res.status(403).json({ status: "error", message: "Invalid password" });
  }
  const nextBuy = normalizePricePayload(req.body);
  if (!nextBuy || typeof nextBuy !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid buy price data" });
  }
  buyPrice = nextBuy;
  saveData();
  res.json({ status: "saved" });
});

app.get("/sell-price", (req, res) => {
  res.json(sellPrice);
});

app.post("/sell-price", (req, res) => {
  const password = String(req.body?.password || "");
  if (password !== PRICE_UPDATE_PASSWORD) {
    return res.status(403).json({ status: "error", message: "Invalid password" });
  }
  const nextSell = normalizePricePayload(req.body);
  if (!nextSell || typeof nextSell !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid sell price data" });
  }
  sellPrice = nextSell;
  saveData();
  res.json({ status: "saved" });
});

app.get("/today-report", (req, res) => {
  const todayKey = formatLocalDate(new Date());
  const todayOrders = orders.filter((order) => {
    if (isOrderCancelled(order)) return false;
    const dt = getOrderDate(order);
    return dt ? formatLocalDate(dt) === todayKey : false;
  });

  const items = {};
  let revenue = 0;
  let profit = 0;
  const currentMonth = getMonthKey(new Date());
  let monthRevenue = 0;
  let monthProfit = 0;

  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const dt = getOrderDate(order);
    if (!dt) return;
    const orderTotal = Number(order.total) || 0;
    const orderProfitBase = Number.isFinite(Number(order.profit))
      ? Number(order.profit)
      : calculateOrderProfit(order);
    const orderProfit = isOrderExcludedFromProfitStats(order) ? 0 : orderProfitBase;

    if (formatLocalDate(dt) === todayKey) {
      revenue += orderTotal;
      profit += orderProfit;
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const qty = Number(item.qty) || 0;
          items[item.name] = (items[item.name] || 0) + qty;
        });
      }
    }

    if (getMonthKey(dt) === currentMonth) {
      monthRevenue += orderTotal;
      monthProfit += orderProfit;
    }
  });

  res.json({
    date: todayKey,
    month: currentMonth,
    ordersCount: todayOrders.length,
    items,
    revenue,
    profit,
    monthRevenue,
    monthProfit,
  });
});

app.post("/cancel-order", (req, res) => {
  const orderId = Number(req.body?.orderId);
  const confirmOrderId = Number(req.body?.confirmOrderId);
  if (!orderId) {
    return res.status(400).json({ status: "error", message: "Invalid orderId" });
  }
  if (Number.isFinite(confirmOrderId) && confirmOrderId !== orderId) {
    return res.status(400).json({ status: "error", message: "Order number mismatch" });
  }

  const order = orders.find((o) => Number(o.id) === orderId);
  if (!order) {
    return res.status(404).json({ status: "not_found" });
  }
  if (isOrderCancelled(order)) {
    return res.status(400).json({ status: "already_cancelled" });
  }

  const createdAt = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  if (!Number.isFinite(createdAt)) {
    return res.status(400).json({ status: "error", message: "Order timestamp missing" });
  }

  const now = Date.now();
  if (now - createdAt > 120000) {
    return res.status(400).json({ status: "expired", message: "Cancel window over (2 min)" });
  }

  if (Array.isArray(order.items)) {
    const distributorRoom = String(order.collectFromRoom || getDistributorRoomByCustomerRoom(order.room));
    if (!distributorStock[distributorRoom]) {
      distributorStock[distributorRoom] = getDefaultProductMap(0);
    }
    order.items.forEach((item) => {
      if (storeStock[item.name] !== undefined) {
        storeStock[item.name] += Number(item.qty) || 0;
      }
      if (distributorStock[distributorRoom][item.name] === undefined) {
        distributorStock[distributorRoom][item.name] = 0;
      }
      distributorStock[distributorRoom][item.name] += Number(item.qty) || 0;
    });
  }

  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  saveData();
  res.json({ status: "cancelled", orderId });
});

app.post("/admin/order-status", (req, res) => {
  const orderId = Number(req.body?.orderId);
  const action = String(req.body?.action || "").toLowerCase();

  if (!orderId || !["accept", "cancel"].includes(action)) {
    return res.status(400).json({ status: "error", message: "Invalid orderId/action" });
  }

  const order = orders.find((o) => Number(o.id) === orderId);
  if (!order) {
    return res.status(404).json({ status: "not_found" });
  }

  if (action === "accept") {
    if (order.status === "cancelled") {
      return res.status(400).json({ status: "error", message: "Cancelled order cannot be accepted" });
    }
    order.status = "accepted";
    saveData();
    return res.json({ status: "accepted", orderId });
  }

  // action === "cancel"
  if (order.status === "cancelled") {
    return res.status(400).json({ status: "already_cancelled" });
  }

  if (Array.isArray(order.items)) {
    const distributorRoom = String(order.collectFromRoom || getDistributorRoomByCustomerRoom(order.room));
    if (!distributorStock[distributorRoom]) {
      distributorStock[distributorRoom] = getDefaultProductMap(0);
    }
    order.items.forEach((item) => {
      if (storeStock[item.name] !== undefined) {
        storeStock[item.name] += Number(item.qty) || 0;
      }
      if (distributorStock[distributorRoom][item.name] === undefined) {
        distributorStock[distributorRoom][item.name] = 0;
      }
      distributorStock[distributorRoom][item.name] += Number(item.qty) || 0;
    });
  }

  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  saveData();
  return res.json({ status: "cancelled", orderId });
});

app.post("/admin/adjust-order", (req, res) => {
  const orderId = Number(req.body?.orderId);
  const adjustedItems = req.body?.items;

  if (!orderId || !adjustedItems || typeof adjustedItems !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid orderId/items" });
  }

  const order = orders.find((o) => Number(o.id) === orderId);
  if (!order) {
    return res.status(404).json({ status: "not_found" });
  }
  if (order.status === "cancelled") {
    return res.status(400).json({ status: "error", message: "Order already cancelled" });
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    return res.status(400).json({ status: "error", message: "Order has no items" });
  }

  const distributorRoom = String(order.collectFromRoom || getDistributorRoomByCustomerRoom(order.room));
  if (!distributorStock[distributorRoom]) {
    distributorStock[distributorRoom] = getDefaultProductMap(0);
  }

  let changed = false;
  const nextItems = [];

  order.items.forEach((item) => {
    const name = String(item.name || "").trim();
    const currentQty = Math.max(0, Number(item.qty) || 0);
    const incomingQty = Number(adjustedItems[name]);
    const newQty = Number.isFinite(incomingQty)
      ? Math.max(0, Math.min(currentQty, Math.floor(incomingQty)))
      : currentQty;
    const reduceBy = currentQty - newQty;

    if (reduceBy > 0) {
      changed = true;
      if (storeStock[name] !== undefined) {
        storeStock[name] += reduceBy;
      }
      if (distributorStock[distributorRoom][name] === undefined) {
        distributorStock[distributorRoom][name] = 0;
      }
      distributorStock[distributorRoom][name] += reduceBy;
    }

    if (newQty > 0) {
      item.qty = newQty;
      nextItems.push(item);
    }
  });

  if (!changed) {
    return res.json({ status: "unchanged", orderId, total: Number(order.total) || 0, items: order.items });
  }

  order.items = nextItems;
  if (order.items.length === 0) {
    order.status = "cancelled";
    order.cancelledAt = new Date().toISOString();
    order.total = 0;
    order.profit = 0;
  } else {
    order.status = "partially_adjusted";
    recalculateOrderTotals(order);
  }

  order.adjustedAt = new Date().toISOString();
  saveData();
  return res.json({
    status: order.status,
    orderId,
    total: Number(order.total) || 0,
    items: order.items,
  });
});

app.post("/accept-order", (req, res) => {
  const orderId = Number(req.body?.orderId);
  if (!orderId) {
    return res.status(400).json({ status: "error", message: "Invalid orderId" });
  }
  const order = orders.find((o) => Number(o.id) === orderId);
  if (!order) {
    return res.status(404).json({ status: "not_found" });
  }
  if (order.status === "cancelled") {
    return res.status(400).json({ status: "error", message: "Cancelled order cannot be accepted" });
  }
  order.status = "accepted";
  saveData();
  return res.json({ status: "accepted", orderId });
});

app.get("/top-customers", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getMonthKey(new Date());

  const spendMap = {};
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (isOrderExcludedFromCustomerStats(order)) return;
    const dt = getOrderDate(order);
    if (!dt || getMonthKey(dt) !== month) return;
    const key = buildCustomerKey(order.name, order.room);
    if (!spendMap[key]) {
      spendMap[key] = {
        name: String(order.name || "").trim() || "Unknown",
        room: String(order.room || "").trim() || "-",
        totalSpent: 0,
        ordersCount: 0,
      };
    }
    spendMap[key].totalSpent += Number(order.total) || 0;
    spendMap[key].ordersCount += 1;
  });

  applyMonthlyManualCustomers(spendMap, month);

  const ranked = Object.values(spendMap)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 3);

  res.json({ month, topCustomers: ranked });
});

app.get("/customers-report", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getMonthKey(new Date());

  const allSpendMap = {};
  const activeSpendMap = {};
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const dt = getOrderDate(order);
    if (!dt || getMonthKey(dt) !== month) return;
    const key = buildCustomerKey(order.name, order.room);
    if (!allSpendMap[key]) {
      allSpendMap[key] = {
        name: String(order.name || "").trim() || "Unknown",
        room: String(order.room || "").trim() || "-",
        totalSpent: 0,
        ordersCount: 0,
      };
    }
    allSpendMap[key].totalSpent += Number(order.total) || 0;
    allSpendMap[key].ordersCount += 1;

    if (isOrderExcludedFromCustomerStats(order)) return;
    if (!activeSpendMap[key]) {
      activeSpendMap[key] = {
        name: String(order.name || "").trim() || "Unknown",
        room: String(order.room || "").trim() || "-",
        totalSpent: 0,
        ordersCount: 0,
      };
    }
    activeSpendMap[key].totalSpent += Number(order.total) || 0;
    activeSpendMap[key].ordersCount += 1;
  });

  applyMonthlyManualCustomers(allSpendMap, month);
  applyMonthlyManualCustomers(activeSpendMap, month);

  const allCustomers = Object.values(allSpendMap).sort((a, b) => b.totalSpent - a.totalSpent);
  const customers = Object.values(activeSpendMap).sort((a, b) => b.totalSpent - a.totalSpent);
  res.json({
    month,
    customers,
    allCustomers,
    activeCustomersCount: customers.length,
    totalCustomers: allCustomers.length,
  });
});

app.get("/customers-lifetime", (req, res) => {
  const spendMap = {};
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const key = buildCustomerKey(order.name, order.room);
    if (!spendMap[key]) {
      spendMap[key] = {
        name: String(order.name || "").trim() || "Unknown",
        room: String(order.room || "").trim() || "-",
        totalSpent: 0,
        ordersCount: 0,
      };
    }
    spendMap[key].totalSpent += Number(order.total) || 0;
    spendMap[key].ordersCount += 1;
  });

  applyLifetimeManualCustomers(spendMap);
  const customers = Object.values(spendMap).sort((a, b) => b.totalSpent - a.totalSpent);
  res.json({ totalCustomers: customers.length, customers });
});

app.get("/admin/customer-spend", (req, res) => {
  const scope = String(req.query.scope || "month").toLowerCase();
  if (scope === "lifetime") {
    const rows = Object.values(manualCustomers.lifetime || {}).sort((a, b) => b.totalSpent - a.totalSpent);
    return res.json({ scope: "lifetime", customers: rows });
  }

  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getMonthKey(new Date());
  const rows = Object.values((manualCustomers.monthly && manualCustomers.monthly[month]) || {})
    .sort((a, b) => b.totalSpent - a.totalSpent);
  return res.json({ scope: "month", month, customers: rows });
});

app.post("/admin/customer-spend", (req, res) => {
  const scope = String(req.body?.scope || "month").toLowerCase();
  const name = String(req.body?.name || "").trim();
  const room = String(req.body?.room || "").trim();
  const totalSpent = Math.max(0, Number(req.body?.totalSpent) || 0);
  const ordersCount = Math.max(0, Number(req.body?.ordersCount) || 0);

  if (!name || !room) {
    return res.status(400).json({ status: "error", message: "Name and room are required" });
  }

  const key = buildCustomerKey(name, room);
  const payload = { name, room, totalSpent, ordersCount };

  if (scope === "lifetime") {
    manualCustomers.lifetime[key] = payload;
    saveData();
    return res.json({ status: "saved", scope: "lifetime", customer: payload });
  }

  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getMonthKey(new Date());
  if (!manualCustomers.monthly[month]) manualCustomers.monthly[month] = {};
  manualCustomers.monthly[month][key] = payload;
  saveData();
  return res.json({ status: "saved", scope: "month", month, customer: payload });
});

app.post("/admin/customer-spend/delete", (req, res) => {
  const scope = String(req.body?.scope || "month").toLowerCase();
  const name = String(req.body?.name || "").trim();
  const room = String(req.body?.room || "").trim();
  if (!name || !room) {
    return res.status(400).json({ status: "error", message: "Name and room are required" });
  }
  const key = buildCustomerKey(name, room);

  if (scope === "lifetime") {
    if (manualCustomers.lifetime && manualCustomers.lifetime[key]) {
      delete manualCustomers.lifetime[key];
      saveData();
    }
    return res.json({ status: "deleted", scope: "lifetime" });
  }

  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getMonthKey(new Date());
  if (manualCustomers.monthly && manualCustomers.monthly[month] && manualCustomers.monthly[month][key]) {
    delete manualCustomers.monthly[month][key];
    if (Object.keys(manualCustomers.monthly[month]).length === 0) {
      delete manualCustomers.monthly[month];
    }
    saveData();
  }
  return res.json({ status: "deleted", scope: "month", month });
});

function handleResetCustomerMoney(req, res) {
  const password = String(req.body?.password || "");
  if (password !== RESET_CUSTOMER_PASSWORD) {
    return res.status(403).json({ status: "error", message: "Invalid password" });
  }

  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getMonthKey(new Date());

  let affected = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const dt = getOrderDate(order);
    if (!dt || getMonthKey(dt) !== month) return;
    if (!order.excludeFromCustomerStats) {
      order.excludeFromCustomerStats = true;
      affected += 1;
    }
  });

  saveData();
  return res.json({ status: "reset", month, affected });
}

function handleResetProfit(req, res) {
  const password = String(req.body?.password || "");
  if (password !== RESET_PROFIT_PASSWORD) {
    return res.status(403).json({ status: "error", message: "Invalid password" });
  }

  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getMonthKey(new Date());

  let affected = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const dt = getOrderDate(order);
    if (!dt || getMonthKey(dt) !== month) return;
    if (!order.excludeFromProfitStats) {
      order.excludeFromProfitStats = true;
      affected += 1;
    }
  });

  saveData();
  return res.json({ status: "reset", month, affected });
}

app.post("/admin/reset-customer-money", handleResetCustomerMoney);
app.post("/reset-customer-money", handleResetCustomerMoney);
app.post("/admin/reset-profit", handleResetProfit);
app.post("/reset-profit", handleResetProfit);

app.get("/orders", (req, res) => {
  res.json(orders);
});

app.get("/distributor-stock", (req, res) => {
  res.json(normalizeDistributorStock(distributorStock));
});

app.post("/distributor-stock", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid distributor stock" });
  }
  distributorStock = normalizeDistributorStock(req.body);
  saveData();
  return res.json({ status: "saved", distributorStock });
});

app.get("/distributor-month-summary", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getMonthKey(new Date());

  const summary = {
    "104": { ordersCount: 0, totalAmount: 0, items: getDefaultProductMap(0) },
    "407": { ordersCount: 0, totalAmount: 0, items: getDefaultProductMap(0) },
    "607": { ordersCount: 0, totalAmount: 0, items: getDefaultProductMap(0) },
  };

  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const dt = getOrderDate(order);
    if (!dt || getMonthKey(dt) !== month) return;
    const room = String(order.collectFromRoom || getDistributorRoomByCustomerRoom(order.room));
    if (!summary[room]) return;

    summary[room].ordersCount += 1;
    summary[room].totalAmount += Number(order.total) || 0;

    if (Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const name = String(item.name || "").trim();
        if (!name) return;
        if (summary[room].items[name] === undefined) summary[room].items[name] = 0;
        summary[room].items[name] += Number(item.qty) || 0;
      });
    }
  });

  res.json({ month, summary });
});
// =====store open/close status ===== 
// get status 
app.get("/store-status",(req,res)=>{res.json({closed:storeClosed});
});

// change status (admin)
app.post("/store-status",(req,res)=>{storeClosed=req.body.closed;
    console.log("STORE STATUS:",storeClosed ?
        "CLOSED":"open");
        res.json({status:"ok"});
    });
    

const PORT = process.env.PORT || 5000;

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
