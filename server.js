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

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { storeStock: defaultStock, orders: [] };
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      storeStock: parsed.storeStock || defaultStock,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    };
  } catch (error) {
    console.error("Failed to parse store-data.json, using defaults", error);
    return { storeStock: defaultStock, orders: [] };
  }
}

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ storeStock, orders }, null, 2),
    "utf8"
  );
}

let { storeStock, orders } = loadData();

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

  order.items.forEach((i) => {
    if (storeStock[i.name] !== undefined) {
      storeStock[i.name] -= i.qty;
    }
  });

  order.id = Date.now();
  order.time = new Date().toLocaleString();

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

  res.json({ status: "ok" });
});

app.get("/orders", (req, res) => {
  res.json(orders);
});

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running");
});
