const mongoose = require("mongoose");
console.log("ENV CHECK:", process.env.MONGO_URI);
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));
  const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "store-data.json");

const defaultStock = {
  Maggi: 24,
  Kurkure: 9,
  Bhujia: 2,
  Ariel: 1,
  "Bhoot Chips": 5,
  "Bingo Onion Chips": 5,
};

const defaultBuyPrice = {
  Maggi: 0,
  Kurkure: 0,
  Bhujia: 0,
  Ariel: 0,
  "Bhoot Chips": 0,
  "Bingo Onion Chips": 0,
};

const defaultSellPrice = {
  Maggi: 20,
  Kurkure: 20,
  Bhujia: 300,
  Ariel: 160,
  "Bhoot Chips": 20,
  "Bingo Onion Chips": 20,
};

function getDefaultProductMap(fillValue) {
  return {
    Maggi: fillValue,
    Kurkure: fillValue,
    Bhujia: fillValue,
    Ariel: fillValue,
    "Bhoot Chips": fillValue,
    "Bingo Onion Chips": fillValue,
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

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      storeStock: defaultStock,
      orders: [],
      buyPrice: defaultBuyPrice,
      sellPrice: defaultSellPrice,
      distributorStock: defaultDistributorStock,
    };
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      storeStock: parsed.storeStock || defaultStock,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      buyPrice: parsed.buyPrice || defaultBuyPrice,
      sellPrice: parsed.sellPrice || defaultSellPrice,
      distributorStock: normalizeDistributorStock(parsed.distributorStock),
    };
  } catch (error) {
    console.error("Failed to parse store-data.json, using defaults", error);
    return {
      storeStock: defaultStock,
      orders: [],
      buyPrice: defaultBuyPrice,
      sellPrice: defaultSellPrice,
      distributorStock: defaultDistributorStock,
    };
  }
}

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ storeStock, orders, buyPrice, sellPrice, distributorStock }, null, 2),
    "utf8"
  );
}

let { storeStock, orders, buyPrice, sellPrice, distributorStock } = loadData();

let storeClosed = false;
const RESET_CUSTOMER_PASSWORD = process.env.RESET_CUSTOMER_PASSWORD || "291";
const PRICE_UPDATE_PASSWORD = process.env.PRICE_UPDATE_PASSWORD || "291";

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

function isOrderCancelled(order) {
  return order && order.status === "cancelled";
}

function isOrderExcludedFromCustomerStats(order) {
  return order && order.excludeFromCustomerStats === true;
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

app.post("/stock", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid stock" });
  }

  storeStock = req.body;
  saveData();
  console.log("Stock Updated:", storeStock);
  res.json({ status: "saved" });
});

app.post("/order", (req, res) => {
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
  const deliveryCharge = Number(order.deliveryCharge) || 0;
  order.total = itemsSubTotal + deliveryCharge;

  order.id = Date.now();
  order.time = new Date().toLocaleString();
  order.createdAt = new Date().toISOString();
  order.status = "active";
  order.cancelledAt = null;
  if (!order.deliveryType) {
    order.deliveryType = order.mode === "pickup" ? "Self Pickup" : "Room Delivery";
  }
  order.collectFromRoom = distributorRoom;
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

  res.json({ status: "ok", orderId: order.id, cancelWindowMs: 180000 });
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
    const orderProfit = Number.isFinite(Number(order.profit))
      ? Number(order.profit)
      : calculateOrderProfit(order);

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
  if (now - createdAt > 180000) {
    return res.status(400).json({ status: "expired", message: "Cancel window over (3 min)" });
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
    const key = `${String(order.name || "").trim()}|${String(order.room || "").trim()}`;
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

  const ranked = Object.values(spendMap)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 3);

  res.json({ month, topCustomers: ranked });
});

app.get("/customers-report", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getMonthKey(new Date());

  const spendMap = {};
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (isOrderExcludedFromCustomerStats(order)) return;
    const dt = getOrderDate(order);
    if (!dt || getMonthKey(dt) !== month) return;
    const key = `${String(order.name || "").trim()}|${String(order.room || "").trim()}`;
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

  const customers = Object.values(spendMap).sort((a, b) => b.totalSpent - a.totalSpent);
  res.json({ month, customers });
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

app.post("/admin/reset-customer-money", handleResetCustomerMoney);
app.post("/reset-customer-money", handleResetCustomerMoney);

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
    

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running");
});
