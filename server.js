const mongoose = require("mongoose");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const webpush = require("web-push");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(__dirname));

const defaultStock = {
  Maggi: 24,
  "Tedhe Medhe": 9,
  "Dark Fantasy": 5,
  "Dark Fantasy Sandwich Creme": 0,
  Borboun: 5,
  "Frist Crop Potato Chips": 0,
  "BRITANNIA Pure Magic Chocolush": 0,
  Namkeen: 2,
  "Onion Chips": 5,
  "Tomato Chips": 5,
  "Unibic Chocolate Chip Cookies": 5,
  "Unibic Kesar Cashew Badam Cookies": 5,
  "Chocokiss Cookies": 5,
  "Mad Angel": 0,
  Kurkure: 0,
};

const defaultBuyPrice = {
  Maggi: 0,
  "Tedhe Medhe": 0,
  "Dark Fantasy": 0,
  "Dark Fantasy Sandwich Creme": 0,
  Borboun: 0,
  "Frist Crop Potato Chips": 0,
  "BRITANNIA Pure Magic Chocolush": 0,
  Namkeen: 0,
  "Onion Chips": 0,
  "Tomato Chips": 0,
  "Unibic Chocolate Chip Cookies": 0,
  "Unibic Kesar Cashew Badam Cookies": 0,
  "Chocokiss Cookies": 0,
  "Mad Angel": 0,
  Kurkure: 0,
};

const defaultSellPrice = {
  Maggi: 20,
  "Tedhe Medhe": 20,
  "Dark Fantasy": 200,
  "Dark Fantasy Sandwich Creme": 30,
  Borboun: 25,
  "Frist Crop Potato Chips": 30,
  "BRITANNIA Pure Magic Chocolush": 7,
  Namkeen: 50,
  "Onion Chips": 30,
  "Tomato Chips": 30,
  "Unibic Chocolate Chip Cookies": 30,
  "Unibic Kesar Cashew Badam Cookies": 60,
  "Chocokiss Cookies": 6,
  "Mad Angel": 50,
  Kurkure: 30,
};

const defaultManualCustomers = {
  monthly: {},
  lifetime: {},
};
const DEFAULT_TOTAL_PROFIT_ADJUSTMENT = 1044;

function getDefaultProductMap(fillValue) {
  return {
    Maggi: fillValue,
    "Tedhe Medhe": fillValue,
    "Dark Fantasy": fillValue,
    "Dark Fantasy Sandwich Creme": fillValue,
    Borboun: fillValue,
    "Frist Crop Potato Chips": fillValue,
    "BRITANNIA Pure Magic Chocolush": fillValue,
    Namkeen: fillValue,
    "Onion Chips": fillValue,
    "Tomato Chips": fillValue,
    "Unibic Chocolate Chip Cookies": fillValue,
    "Unibic Kesar Cashew Badam Cookies": fillValue,
    "Chocokiss Cookies": fillValue,
    "Mad Angel": fillValue,
    Kurkure: fillValue,
  };
}

function migrateLegacyProductMap(rawMap) {
  const next = rawMap && typeof rawMap === "object" ? { ...rawMap } : {};
  if (next["Tedhe Medhe"] === undefined && next.Kurkure !== undefined) {
    next["Tedhe Medhe"] = next.Kurkure;
  }
  return next;
}

function migrateLegacyDistributorStock(rawStock) {
  if (!rawStock || typeof rawStock !== "object") return rawStock;
  const next = { ...rawStock };
  ["104", "407", "607"].forEach((room) => {
    next[room] = migrateLegacyProductMap(next[room]);
  });
  return next;
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
      const name = normalizeCustomerName(entry.name);
      const room = normalizeCustomerRoom(entry.room);
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
    const name = normalizeCustomerName(entry.name);
    const room = normalizeCustomerRoom(entry.room);
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
    monthProfitAdjustments: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    monthDeliveryProfitAdjustments: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    totalProfitAdjustment: { type: Number, default: DEFAULT_TOTAL_PROFIT_ADJUSTMENT },
    activeMonthKey: { type: String, default: "" },
    buyPrice: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultBuyPrice }) },
    sellPrice: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultSellPrice }) },
    distributorStock: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...defaultDistributorStock }) },
    storeClosed: { type: Boolean, default: false },
    roomDeliveryBlocked: { type: Boolean, default: false },
    autoCloseAt1230Enabled: { type: Boolean, default: false },
    autoCloseLastRunDate: { type: String, default: "" },
    closingSoonAlertEnabled: { type: Boolean, default: false },
    sleepingCallAlertEnabled: { type: Boolean, default: false },
    outOfHostelAlertEnabled: { type: Boolean, default: false },
    examDeliveryOffAlertEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const StoreState = mongoose.model("StoreState", StoreStateSchema);

let storeStock = { ...defaultStock };
let orders = [];
let pushSubscriptions = [];
let manualCustomers = normalizeManualCustomers(defaultManualCustomers);
let monthProfitAdjustments = {};
let monthDeliveryProfitAdjustments = {};
let totalProfitAdjustment = DEFAULT_TOTAL_PROFIT_ADJUSTMENT;
let activeMonthKey = "";
let buyPrice = { ...defaultBuyPrice };
let sellPrice = { ...defaultSellPrice };
let distributorStock = normalizeDistributorStock(defaultDistributorStock);
let storeClosed = false;
let roomDeliveryBlocked = false;
let autoCloseAt1230Enabled = false;
let autoCloseLastRunDate = "";
let closingSoonAlertEnabled = false;
let sleepingCallAlertEnabled = false;
let outOfHostelAlertEnabled = false;
let examDeliveryOffAlertEnabled = false;
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

function normalizeSellPriceMap(rawMap) {
  const out = mergeProductMap(defaultSellPrice, rawMap, 0);
  return out;
}

async function saveData() {
  try {
    await StoreState.findOneAndUpdate(
      { singletonKey: "main" },
      {
        singletonKey: "main",
        storeStock,
        orders,
        pushSubscriptions,
        manualCustomers,
        monthProfitAdjustments,
        monthDeliveryProfitAdjustments,
        totalProfitAdjustment,
        activeMonthKey,
        buyPrice,
        sellPrice,
        distributorStock,
        storeClosed,
        roomDeliveryBlocked,
        autoCloseAt1230Enabled,
        autoCloseLastRunDate,
        closingSoonAlertEnabled,
        sleepingCallAlertEnabled,
        outOfHostelAlertEnabled,
        examDeliveryOffAlertEnabled,
      },
      { upsert: true, setDefaultsOnInsert: true, new: true }
    );
    return true;
  } catch (err) {
    console.error("MongoDB save failed:", err);
    return false;
  }
}

async function loadStateFromMongo() {
  const doc = await StoreState.findOne({ singletonKey: "main" }).lean();
  if (!doc) {
    activeMonthKey = getMonthKey(new Date());
    await StoreState.create({
      singletonKey: "main",
      storeStock,
      orders,
      pushSubscriptions,
      manualCustomers,
      monthProfitAdjustments,
      monthDeliveryProfitAdjustments,
      totalProfitAdjustment,
      activeMonthKey,
      buyPrice,
      sellPrice,
      distributorStock,
      storeClosed,
      roomDeliveryBlocked,
      autoCloseAt1230Enabled,
      autoCloseLastRunDate,
      closingSoonAlertEnabled,
      sleepingCallAlertEnabled,
      outOfHostelAlertEnabled,
      examDeliveryOffAlertEnabled,
    });
    return;
  }

  const migratedStoreStock = migrateLegacyProductMap(doc.storeStock);
  const migratedBuyPrice = migrateLegacyProductMap(doc.buyPrice);
  const migratedSellPrice = migrateLegacyProductMap(doc.sellPrice);
  const migratedDistributorStock = migrateLegacyDistributorStock(doc.distributorStock);

  storeStock = mergeProductMap(defaultStock, migratedStoreStock, 0);
  orders = Array.isArray(doc.orders) ? doc.orders : [];
  pushSubscriptions = normalizePushSubscriptions(doc.pushSubscriptions);
  manualCustomers = normalizeManualCustomers(doc.manualCustomers);
  monthProfitAdjustments = normalizeMonthProfitAdjustments(doc.monthProfitAdjustments);
  monthDeliveryProfitAdjustments = normalizeMonthProfitAdjustments(doc.monthDeliveryProfitAdjustments);
  totalProfitAdjustment = Number.isFinite(Number(doc.totalProfitAdjustment))
    ? Number(doc.totalProfitAdjustment)
    : DEFAULT_TOTAL_PROFIT_ADJUSTMENT;
  activeMonthKey =
    typeof doc.activeMonthKey === "string" && /^\d{4}-\d{2}$/.test(doc.activeMonthKey)
      ? doc.activeMonthKey
      : getMonthKey(new Date());
  buyPrice = mergeProductMap(defaultBuyPrice, migratedBuyPrice, 0);
  sellPrice = normalizeSellPriceMap(migratedSellPrice);
  distributorStock = normalizeDistributorStock(migratedDistributorStock);
  storeClosed = !!doc.storeClosed;
  roomDeliveryBlocked = !!doc.roomDeliveryBlocked;
  autoCloseAt1230Enabled = !!doc.autoCloseAt1230Enabled;
  autoCloseLastRunDate = String(doc.autoCloseLastRunDate || "");
  closingSoonAlertEnabled = !!doc.closingSoonAlertEnabled;
  sleepingCallAlertEnabled = !!doc.sleepingCallAlertEnabled;
  outOfHostelAlertEnabled = !!doc.outOfHostelAlertEnabled;
  examDeliveryOffAlertEnabled = !!doc.examDeliveryOffAlertEnabled;
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
    maybeRunAutoClose1230();
    next();
  } catch (err) {
    console.error("Database init failed:", err);
    res.status(500).json({ status: "error", message: "Database unavailable" });
  }
});
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_SESSION_COOKIE = "monty_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_COOKIE_SECURE = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const adminSessions = new Map();
const ADMIN_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const ADMIN_LOGIN_MAX_ATTEMPTS = 8;
const adminLoginAttempts = new Map();
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
if (!ADMIN_PASSWORD) {
  console.warn("Admin login disabled: set ADMIN_PASSWORD on the server environment.");
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  String(cookieHeader || "")
    .split(";")
    .forEach((entry) => {
      const idx = entry.indexOf("=");
      if (idx <= 0) return;
      const key = entry.slice(0, idx).trim();
      const value = entry.slice(idx + 1).trim();
      if (!key) return;
      out[key] = decodeURIComponent(value);
    });
  return out;
}

function getAdminSessionToken(req) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return String(cookies[ADMIN_SESSION_COOKIE] || "").trim();
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.ip || req.socket?.remoteAddress || "unknown");
}

function pruneAdminLoginAttempts(now = Date.now()) {
  adminLoginAttempts.forEach((entry, key) => {
    if (!entry || !Number.isFinite(entry.firstAt) || (now - entry.firstAt) > ADMIN_LOGIN_WINDOW_MS) {
      adminLoginAttempts.delete(key);
    }
  });
}

function getAdminLoginAttemptState(req) {
  pruneAdminLoginAttempts();
  const key = getClientIp(req);
  const now = Date.now();
  const current = adminLoginAttempts.get(key);
  if (!current || !Number.isFinite(current.firstAt) || (now - current.firstAt) > ADMIN_LOGIN_WINDOW_MS) {
    const fresh = { count: 0, firstAt: now };
    adminLoginAttempts.set(key, fresh);
    return fresh;
  }
  return current;
}

function registerAdminLoginFailure(req) {
  const state = getAdminLoginAttemptState(req);
  state.count += 1;
  return state;
}

function clearAdminLoginAttempts(req) {
  adminLoginAttempts.delete(getClientIp(req));
}

function isAdminLoginRateLimited(req) {
  const state = getAdminLoginAttemptState(req);
  if (state.count < ADMIN_LOGIN_MAX_ATTEMPTS) return false;
  const retryAfterMs = Math.max(0, ADMIN_LOGIN_WINDOW_MS - (Date.now() - state.firstAt));
  return {
    retryAfterMs,
    retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

function isValidAdminPassword(passwordRaw) {
  const password = String(passwordRaw || "").trim();
  if (!password || !ADMIN_PASSWORD) return false;
  const expected = Buffer.from(ADMIN_PASSWORD, "utf8");
  const provided = Buffer.from(password, "utf8");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function setAdminSessionCookie(res, token) {
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: ADMIN_COOKIE_SECURE,
    maxAge: ADMIN_SESSION_TTL_MS,
    path: "/",
  });
}

function clearAdminSessionCookie(res) {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: ADMIN_COOKIE_SECURE,
    path: "/",
  });
}

function createAdminSession(res) {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, { expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
  setAdminSessionCookie(res, token);
  return token;
}

function hasActiveAdminSession(req) {
  const token = getAdminSessionToken(req);
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  return true;
}

function destroyAdminSession(req, res) {
  const token = getAdminSessionToken(req);
  if (token) {
    adminSessions.delete(token);
  }
  clearAdminSessionCookie(res);
}

function requireAdminSession(req, res, next) {
  if (hasActiveAdminSession(req)) return next();
  destroyAdminSession(req, res);
  return res.status(401).json({ status: "unauthorized", message: "Admin login required" });
}

const ADMIN_PROTECTED_PATHS = new Set([
  "/admin/offline-sale",
  "/offline-sale",
  "/buy-price",
  "/sell-price",
  "/today-report",
  "/admin/order-status",
  "/admin/adjust-order",
  "/accept-order",
  "/customers-report",
  "/customers-lifetime",
  "/admin/customer-spend",
  "/admin/customer-spend/delete",
  "/admin/reset-customer-money",
  "/reset-customer-money",
  "/admin/reset-profit",
  "/reset-profit",
  "/admin/set-month-profit",
  "/set-month-profit",
  "/admin/set-month-delivery-profit",
  "/set-month-delivery-profit",
  "/admin/set-total-profit",
  "/set-total-profit",
  "/admin/month-state",
  "/admin/reset-month",
  "/orders",
  "/distributor-stock",
  "/distributor-month-summary",
]);

const ADMIN_PROTECTED_MUTATION_PATHS = new Set([
  "/stock",
  "/store-status",
  "/auto-close-status",
  "/closing-alert-status",
  "/sleeping-alert-status",
  "/out-of-hostel-alert-status",
  "/exam-delivery-alert-status",
  "/delivery-status",
]);

app.get("/admin/session", (req, res) => {
  if (!hasActiveAdminSession(req)) {
    destroyAdminSession(req, res);
    return res.status(401).json({ status: "unauthorized" });
  }
  return res.json({ status: "ok" });
});

app.post("/admin/session", (req, res) => {
  if (!ADMIN_PASSWORD) {
    destroyAdminSession(req, res);
    return res.status(503).json({ status: "disabled", message: "Admin login is disabled on this server" });
  }
  const rateLimitState = isAdminLoginRateLimited(req);
  if (rateLimitState) {
    return res.status(429).json({
      status: "rate_limited",
      message: `Too many login attempts. Try again in ${rateLimitState.retryAfterSec}s`,
    });
  }
  if (!isValidAdminPassword(req.body?.password)) {
    registerAdminLoginFailure(req);
    destroyAdminSession(req, res);
    return res.status(403).json({ status: "error", message: "Invalid password" });
  }
  clearAdminLoginAttempts(req);
  createAdminSession(res);
  return res.json({ status: "ok" });
});

app.post("/admin/logout", (req, res) => {
  destroyAdminSession(req, res);
  return res.json({ status: "logged_out" });
});

app.use((req, res, next) => {
  if (ADMIN_PROTECTED_PATHS.has(req.path)) {
    return requireAdminSession(req, res, next);
  }
  if (req.method !== "GET" && ADMIN_PROTECTED_MUTATION_PATHS.has(req.path)) {
    return requireAdminSession(req, res, next);
  }
  return next();
});

function normalizeMonthProfitAdjustments(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.keys(raw).forEach((month) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const n = Number(raw[month]);
    if (Number.isFinite(n)) out[month] = n;
  });
  return out;
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

function formatOrderDisplayTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function getIstParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const byType = {};
  parts.forEach((p) => {
    if (p.type !== "literal") byType[p.type] = p.value;
  });
  return {
    dateKey: `${byType.year}-${byType.month}-${byType.day}`,
    hour: Number(byType.hour) || 0,
    minute: Number(byType.minute) || 0,
  };
}

function maybeRunAutoClose1230() {
  if (!autoCloseAt1230Enabled) return;
  const nowIst = getIstParts(new Date());
  const crossed1230 = nowIst.hour > 0 || (nowIst.hour === 0 && nowIst.minute >= 30);
  if (!crossed1230) return;
  if (autoCloseLastRunDate === nowIst.dateKey) return;

  storeClosed = true;
  autoCloseLastRunDate = nowIst.dateKey;
  saveData();
  console.log(`AUTO CLOSE 12:30 AM applied for ${nowIst.dateKey} (IST)`);
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
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const byType = {};
  parts.forEach((p) => {
    if (p.type !== "literal") byType[p.type] = p.value;
  });
  return `${byType.year}-${byType.month}`;
}

function getActiveMonthKey() {
  if (/^\d{4}-\d{2}$/.test(activeMonthKey)) return activeMonthKey;
  activeMonthKey = getMonthKey(new Date());
  return activeMonthKey;
}

function getNextMonthKey(monthKeyRaw) {
  const monthKey = /^\d{4}-\d{2}$/.test(String(monthKeyRaw || "")) ? String(monthKeyRaw) : getActiveMonthKey();
  const [yearRaw, monthRaw] = monthKey.split("-");
  let year = Number(yearRaw) || new Date().getFullYear();
  let month = Number(monthRaw) || 1;
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getOrderReportingMonth(order) {
  if (order && typeof order.reportingMonth === "string" && /^\d{4}-\d{2}$/.test(order.reportingMonth)) {
    return order.reportingMonth;
  }
  const dt = getOrderDate(order);
  return dt ? getMonthKey(dt) : getActiveMonthKey();
}

function normalizeCustomerName(nameRaw) {
  return String(nameRaw || "").replace(/\s+/g, " ").trim();
}

function normalizeCustomerRoom(roomRaw) {
  return String(roomRaw || "").trim();
}

function buildCustomerKey(nameRaw, roomRaw) {
  const name = normalizeCustomerName(nameRaw).toLowerCase();
  const room = normalizeCustomerRoom(roomRaw);
  return `${name}|${room}`;
}

function setCustomerSpendRow(spendMap, key, row) {
  spendMap[key] = {
    name: normalizeCustomerName(row.name) || "Unknown",
    room: normalizeCustomerRoom(row.room) || "-",
    totalSpent: Math.max(0, Number(row.totalSpent) || 0),
    ordersCount: Math.max(0, Number(row.ordersCount) || 0),
  };
}

function ensureManualCustomerLedger() {
  if (!manualCustomers || typeof manualCustomers !== "object") {
    manualCustomers = normalizeManualCustomers(defaultManualCustomers);
  }
  if (!manualCustomers.monthly || typeof manualCustomers.monthly !== "object") {
    manualCustomers.monthly = {};
  }
  if (!manualCustomers.lifetime || typeof manualCustomers.lifetime !== "object") {
    manualCustomers.lifetime = {};
  }
}

function addOrderToCustomerLedger(order) {
  if (!order || isOrderCancelled(order) || isOrderExcludedFromCustomerStats(order)) return;

  ensureManualCustomerLedger();

  const key = buildCustomerKey(order.name, order.room);
  const name = normalizeCustomerName(order.name) || "Unknown";
  const room = normalizeCustomerRoom(order.room) || "-";
  const orderTotal = Math.max(0, Number(order.total) || 0);
  const orderCount = 1;
  const month = getOrderReportingMonth(order);

  if (!manualCustomers.monthly[month]) {
    manualCustomers.monthly[month] = {};
  }
  if (!manualCustomers.monthly[month][key]) {
    manualCustomers.monthly[month][key] = { name, room, totalSpent: 0, ordersCount: 0 };
  }
  manualCustomers.monthly[month][key].name = name;
  manualCustomers.monthly[month][key].room = room;
  manualCustomers.monthly[month][key].totalSpent += orderTotal;
  manualCustomers.monthly[month][key].ordersCount += orderCount;

  if (!manualCustomers.lifetime[key]) {
    manualCustomers.lifetime[key] = { name, room, totalSpent: 0, ordersCount: 0 };
  }
  manualCustomers.lifetime[key].name = name;
  manualCustomers.lifetime[key].room = room;
  manualCustomers.lifetime[key].totalSpent += orderTotal;
  manualCustomers.lifetime[key].ordersCount += orderCount;
}

function pruneCustomerLedgerEntry(bucket, key) {
  if (!bucket || !bucket[key]) return;
  const row = bucket[key];
  const totalSpent = Math.max(0, Number(row.totalSpent) || 0);
  const ordersCount = Math.max(0, Number(row.ordersCount) || 0);
  row.totalSpent = totalSpent;
  row.ordersCount = ordersCount;
  if (totalSpent === 0 && ordersCount === 0) {
    delete bucket[key];
  }
}

function adjustCustomerLedgerForOrder(order, totalDelta, ordersDelta = 0) {
  if (!order || isOrderExcludedFromCustomerStats(order)) return;

  ensureManualCustomerLedger();

  const key = buildCustomerKey(order.name, order.room);
  const month = getOrderReportingMonth(order);
  const totalChange = Number(totalDelta) || 0;
  const ordersChange = Number(ordersDelta) || 0;

  if (manualCustomers.monthly[month] && manualCustomers.monthly[month][key]) {
    manualCustomers.monthly[month][key].totalSpent = Math.max(
      0,
      (Number(manualCustomers.monthly[month][key].totalSpent) || 0) + totalChange
    );
    manualCustomers.monthly[month][key].ordersCount = Math.max(
      0,
      (Number(manualCustomers.monthly[month][key].ordersCount) || 0) + ordersChange
    );
    pruneCustomerLedgerEntry(manualCustomers.monthly[month], key);
    if (Object.keys(manualCustomers.monthly[month]).length === 0) {
      delete manualCustomers.monthly[month];
    }
  }

  if (manualCustomers.lifetime[key]) {
    manualCustomers.lifetime[key].totalSpent = Math.max(
      0,
      (Number(manualCustomers.lifetime[key].totalSpent) || 0) + totalChange
    );
    manualCustomers.lifetime[key].ordersCount = Math.max(
      0,
      (Number(manualCustomers.lifetime[key].ordersCount) || 0) + ordersChange
    );
    pruneCustomerLedgerEntry(manualCustomers.lifetime, key);
  }
}

function sortCustomersBySpend(rows) {
  return rows.sort((a, b) => {
    const spentDiff = (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0);
    if (spentDiff !== 0) return spentDiff;

    const ordersDiff = (Number(b.ordersCount) || 0) - (Number(a.ordersCount) || 0);
    if (ordersDiff !== 0) return ordersDiff;

    const nameDiff = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    if (nameDiff !== 0) return nameDiff;

    return String(a.room || "").localeCompare(String(b.room || ""), undefined, { numeric: true, sensitivity: "base" });
  });
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
    setCustomerSpendRow(spendMap, key, {
      name: normalizeCustomerName(row.name) || "Unknown",
      room: normalizeCustomerRoom(row.room) || "-",
      totalSpent: Math.max(0, Number(row.totalSpent) || 0),
      ordersCount: Math.max(0, Number(row.ordersCount) || 0),
    });
  });
}

function buildMonthlyCustomerSpendMaps(month) {
  const allSpendMap = {};
  const activeSpendMap = {};
  const excludedSpendMap = {};

  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (getOrderReportingMonth(order) !== month) return;

    const key = buildCustomerKey(order.name, order.room);
    const baseRow = {
      name: normalizeCustomerName(order.name) || "Unknown",
      room: normalizeCustomerRoom(order.room) || "-",
      totalSpent: 0,
      ordersCount: 0,
    };

    if (!allSpendMap[key]) {
      allSpendMap[key] = { ...baseRow };
    }
    allSpendMap[key].totalSpent += Number(order.total) || 0;
    allSpendMap[key].ordersCount += 1;

    if (isOrderExcludedFromCustomerStats(order)) {
      if (!excludedSpendMap[key]) {
        excludedSpendMap[key] = { ...baseRow };
      }
      excludedSpendMap[key].totalSpent += Number(order.total) || 0;
      excludedSpendMap[key].ordersCount += 1;
      return;
    }

    if (!activeSpendMap[key]) {
      activeSpendMap[key] = { ...baseRow };
    }
    activeSpendMap[key].totalSpent += Number(order.total) || 0;
    activeSpendMap[key].ordersCount += 1;
  });

  applyMonthlyManualCustomers(allSpendMap, month);
  applyMonthlyManualCustomers(activeSpendMap, month);

  return { allSpendMap, activeSpendMap, excludedSpendMap };
}

async function readStoreFlagsFromDb() {
  const doc = await StoreState.findOne({ singletonKey: "main" })
    .select({ storeClosed: 1, roomDeliveryBlocked: 1, autoCloseAt1230Enabled: 1, autoCloseLastRunDate: 1, closingSoonAlertEnabled: 1, sleepingCallAlertEnabled: 1, outOfHostelAlertEnabled: 1, examDeliveryOffAlertEnabled: 1 })
    .lean();
  if (!doc) return null;
  return {
    storeClosed: !!doc.storeClosed,
    roomDeliveryBlocked: !!doc.roomDeliveryBlocked,
    autoCloseAt1230Enabled: !!doc.autoCloseAt1230Enabled,
    autoCloseLastRunDate: String(doc.autoCloseLastRunDate || ""),
    closingSoonAlertEnabled: !!doc.closingSoonAlertEnabled,
    sleepingCallAlertEnabled: !!doc.sleepingCallAlertEnabled,
    outOfHostelAlertEnabled: !!doc.outOfHostelAlertEnabled,
    examDeliveryOffAlertEnabled: !!doc.examDeliveryOffAlertEnabled,
  };
}

async function persistStoreClosed(nextClosed) {
  const doc = await StoreState.findOneAndUpdate(
    { singletonKey: "main" },
    {
      $set: {
        singletonKey: "main",
        storeClosed: !!nextClosed,
      },
    },
    { upsert: true, setDefaultsOnInsert: true, new: true }
  ).lean();
  return !!(doc && doc.storeClosed);
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
    setCustomerSpendRow(spendMap, key, {
      name: normalizeCustomerName(row.name) || "Unknown",
      room: normalizeCustomerRoom(row.room) || "-",
      totalSpent: Math.max(0, Number(row.totalSpent) || 0),
      ordersCount: Math.max(0, Number(row.ordersCount) || 0),
    });
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

app.get("/storefront-prices", (req, res) => {
  res.json(sellPrice);
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

  const payload = req.body;
  const hasEnvelope =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.stock &&
    typeof payload.stock === "object";
  const incomingStock = hasEnvelope ? payload.stock : payload;
  storeStock = mergeProductMap(storeStock, incomingStock, 0);

  let offlineProfitAdded = 0;
  if (hasEnvelope && Number.isFinite(Number(payload.offlineProfitDelta))) {
    offlineProfitAdded = Number(payload.offlineProfitDelta);
    if (offlineProfitAdded !== 0) {
      totalProfitAdjustment += offlineProfitAdded;
      const month = getActiveMonthKey();
      monthProfitAdjustments[month] = (Number(monthProfitAdjustments[month]) || 0) + offlineProfitAdded;
    }
  }

  saveData();
  console.log("Stock Updated:", storeStock);
  res.json({
    status: offlineProfitAdded !== 0 ? "saved_with_offline_profit" : "saved",
    offlineProfitAdded,
    totalProfitAdjustment,
  });
});

function handleOfflineSale(req, res) {
  const itemName = String(req.body?.itemName || "").trim();
  const qty = Number(req.body?.qty);
  if (!itemName || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ status: "error", message: "Invalid itemName/qty" });
  }
  if (!Object.prototype.hasOwnProperty.call(storeStock, itemName)) {
    return res.status(400).json({ status: "error", message: "Unknown item" });
  }

  const available = Number(storeStock[itemName]) || 0;
  if (qty > available) {
    return res.status(400).json({
      status: "error",
      message: `Only ${available} in stock for ${itemName}`,
      available,
    });
  }

  const rawSell = Number(req.body?.sellPrice);
  const rawBuy = Number(req.body?.buyPrice);
  const sellAt = Number.isFinite(rawSell) ? rawSell : (Number(sellPrice[itemName]) || 0);
  const buyAt = Number.isFinite(rawBuy) ? rawBuy : (Number(buyPrice[itemName]) || 0);
  const profitAdded = (sellAt - buyAt) * qty;

  storeStock[itemName] = available - qty;
  totalProfitAdjustment += profitAdded;
  const month = getActiveMonthKey();
  monthProfitAdjustments[month] = (Number(monthProfitAdjustments[month]) || 0) + profitAdded;
  saveData();

  return res.json({
    status: "offline_sale_saved",
    itemName,
    qty,
    stockLeft: Number(storeStock[itemName]) || 0,
    sellAt,
    buyAt,
    profitAdded,
    totalProfitAdjustment,
    month,
    monthProfitAdjustment: Number(monthProfitAdjustments[month]) || 0,
  });
}
app.post("/admin/offline-sale", handleOfflineSale);
app.post("/offline-sale", handleOfflineSale);

app.post("/order", async (req, res) => {
  const order = req.body;

  if (!order || !Array.isArray(order.items)) {
    return res.status(400).json({ status: "error", message: "Invalid order" });
  }

  const normalizedMode = String(order.mode || "").toLowerCase().trim() === "delivery" ? "delivery" : "pickup";
  if (normalizedMode === "delivery" && roomDeliveryBlocked) {
    return res.status(400).json({ status: "delivery_blocked", message: "Room delivery is not possible at this time" });
  }
  order.mode = normalizedMode;
  order.name = normalizeCustomerName(order.name);
  order.room = normalizeCustomerRoom(order.room);

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
  const deliveryCharge = normalizedMode === "delivery" ? 10 : 0;
  order.deliveryCharge = deliveryCharge;
  order.total = itemsSubTotal + deliveryCharge;

  order.id = Date.now();
  order.time = formatOrderDisplayTime(new Date());
  order.createdAt = new Date().toISOString();
  order.reportingMonth = getActiveMonthKey();
  order.status = "active";
  order.cancelledAt = null;
  const cancelToken = crypto.randomBytes(24).toString("hex");
  order.cancelTokenHash = crypto.createHash("sha256").update(cancelToken).digest("hex");
  if (!order.deliveryType) {
    order.deliveryType = order.mode === "pickup" ? "Self Pickup" : "Room Delivery";
  }
  order.collectFromRoom = String(order.collectFromRoom || distributorRoom);
  order.profit = calculateOrderProfit(order);
  addOrderToCustomerLedger(order);

  const deliveryText =
    order.mode === "pickup"
      ? "SELF PICKUP"
      : `ROOM DELIVERY (₹${order.deliveryCharge})`;

  orders.push(order);
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not save order" });
  }

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

  res.json({ status: "ok", orderId: order.id, cancelWindowMs: 120000, cancelToken });
});

app.get("/buy-price", (req, res) => {
  res.json(buyPrice);
});

app.post("/buy-price", (req, res) => {
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
  const nextSell = normalizePricePayload(req.body);
  if (!nextSell || typeof nextSell !== "object") {
    return res.status(400).json({ status: "error", message: "Invalid sell price data" });
  }
  sellPrice = normalizeSellPriceMap(nextSell);
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
  let deliveryProfit = 0;
  const currentMonth = getActiveMonthKey();
  const monthProfitAdjustment = Number(monthProfitAdjustments[currentMonth]) || 0;
  const monthDeliveryProfitAdjustment = Number(monthDeliveryProfitAdjustments[currentMonth]) || 0;
  let monthRevenue = 0;
  let monthProfit = 0;
  let monthDeliveryProfit = 0;
  let totalProfit = 0;

  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const dt = getOrderDate(order);
    if (!dt) return;
    const orderTotal = Number(order.total) || 0;
    const orderProfitBase = Number.isFinite(Number(order.profit))
      ? Number(order.profit)
      : calculateOrderProfit(order);
    const orderProfit = isOrderExcludedFromProfitStats(order) ? 0 : orderProfitBase;
    const orderDeliveryProfitBase =
      String(order.mode || "").toLowerCase() === "delivery"
        ? (Number(order.deliveryCharge) || 0)
        : 0;
    const orderDeliveryProfit = isOrderExcludedFromProfitStats(order) ? 0 : orderDeliveryProfitBase;
    totalProfit += orderProfit;

    if (formatLocalDate(dt) === todayKey) {
      revenue += orderTotal;
      profit += orderProfit;
      deliveryProfit += orderDeliveryProfit;
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const qty = Number(item.qty) || 0;
          items[item.name] = (items[item.name] || 0) + qty;
        });
      }
    }

    if (getOrderReportingMonth(order) === currentMonth) {
      monthRevenue += orderTotal;
      monthProfit += orderProfit;
      monthDeliveryProfit += orderDeliveryProfit;
    }
  });

  res.json({
    date: todayKey,
    month: currentMonth,
    ordersCount: todayOrders.length,
    items,
    revenue,
    profit,
    deliveryProfit,
    monthRevenue,
    monthProfit: monthProfit + monthProfitAdjustment,
    monthDeliveryProfit: monthDeliveryProfit + monthDeliveryProfitAdjustment,
    totalProfit: totalProfit + totalProfitAdjustment,
    totalProfitAdjustment,
    monthProfitAdjustment,
    monthDeliveryProfitAdjustment,
  });
});

app.post("/cancel-order", async (req, res) => {
  const orderId = Number(req.body?.orderId);
  const confirmOrderId = Number(req.body?.confirmOrderId);
  const cancelToken = String(req.body?.cancelToken || "").trim();
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
  if (!cancelToken) {
    return res.status(400).json({ status: "error", message: "Cancel token required" });
  }
  const expectedTokenHash = String(order.cancelTokenHash || "").trim();
  const providedTokenHash = crypto.createHash("sha256").update(cancelToken).digest("hex");
  if (
    !expectedTokenHash ||
    expectedTokenHash.length !== providedTokenHash.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedTokenHash, "utf8"), Buffer.from(providedTokenHash, "utf8"))
  ) {
    return res.status(403).json({ status: "forbidden", message: "Invalid cancel token" });
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

  adjustCustomerLedgerForOrder(order, -(Number(order.total) || 0), -1);
  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  order.cancelTokenHash = null;
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not cancel order" });
  }
  res.json({ status: "cancelled", orderId });
});

app.post("/admin/order-status", async (req, res) => {
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
    if (!(await saveData())) {
      return res.status(500).json({ status: "error", message: "Could not update order" });
    }
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

  adjustCustomerLedgerForOrder(order, -(Number(order.total) || 0), -1);
  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not cancel order" });
  }
  return res.json({ status: "cancelled", orderId });
});

app.post("/admin/adjust-order", async (req, res) => {
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
  const previousTotal = Number(order.total) || 0;

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

  const totalDelta = (Number(order.total) || 0) - previousTotal;
  const ordersDelta = order.status === "cancelled" ? -1 : 0;
  if (totalDelta !== 0 || ordersDelta !== 0) {
    adjustCustomerLedgerForOrder(order, totalDelta, ordersDelta);
  }

  order.adjustedAt = new Date().toISOString();
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not adjust order" });
  }
  return res.json({
    status: order.status,
    orderId,
    total: Number(order.total) || 0,
    items: order.items,
  });
});

app.post("/accept-order", async (req, res) => {
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
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not accept order" });
  }
  return res.json({ status: "accepted", orderId });
});

app.get("/top-customers", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getActiveMonthKey();
  const { allSpendMap } = buildMonthlyCustomerSpendMaps(month);
  const ranked = sortCustomersBySpend(Object.values(allSpendMap)).slice(0, 3);

  res.json({ month, topCustomers: ranked });
});

app.get("/customers-report", (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getActiveMonthKey();
  const { allSpendMap, activeSpendMap, excludedSpendMap } = buildMonthlyCustomerSpendMaps(month);

  const allCustomers = sortCustomersBySpend(Object.values(allSpendMap));
  const customers = sortCustomersBySpend(Object.values(activeSpendMap));
  const excludedCustomers = sortCustomersBySpend(Object.values(excludedSpendMap));
  res.json({
    month,
    customers,
    allCustomers,
    excludedCustomers,
    activeCustomersCount: customers.length,
    totalCustomers: allCustomers.length,
    excludedCustomersCount: excludedCustomers.length,
  });
});

app.get("/customers-lifetime", (req, res) => {
  const spendMap = {};
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const key = buildCustomerKey(order.name, order.room);
    if (!spendMap[key]) {
      spendMap[key] = {
        name: normalizeCustomerName(order.name) || "Unknown",
        room: normalizeCustomerRoom(order.room) || "-",
        totalSpent: 0,
        ordersCount: 0,
      };
    }
    spendMap[key].totalSpent += Number(order.total) || 0;
    spendMap[key].ordersCount += 1;
  });

  applyLifetimeManualCustomers(spendMap);
  const customers = sortCustomersBySpend(Object.values(spendMap));
  res.json({ totalCustomers: customers.length, customers });
});

app.get("/admin/customer-spend", (req, res) => {
  const scope = String(req.query.scope || "month").toLowerCase();
  if (scope === "lifetime") {
    const rows = sortCustomersBySpend(Object.values(manualCustomers.lifetime || {}));
    return res.json({ scope: "lifetime", customers: rows });
  }

  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : getActiveMonthKey();
  const rows = sortCustomersBySpend(Object.values((manualCustomers.monthly && manualCustomers.monthly[month]) || {}));
  return res.json({ scope: "month", month, customers: rows });
});

app.post("/admin/customer-spend", async (req, res) => {
  const scope = String(req.body?.scope || "month").toLowerCase();
  const name = normalizeCustomerName(req.body?.name);
  const room = normalizeCustomerRoom(req.body?.room);
  const totalSpent = Math.max(0, Number(req.body?.totalSpent) || 0);
  const ordersCount = Math.max(0, Number(req.body?.ordersCount) || 0);

  if (!name || !room) {
    return res.status(400).json({ status: "error", message: "Name and room are required" });
  }

  const key = buildCustomerKey(name, room);
  const payload = { name, room, totalSpent, ordersCount };

  if (scope === "lifetime") {
    manualCustomers.lifetime[key] = payload;
    if (!(await saveData())) {
      return res.status(500).json({ status: "error", message: "Could not save customer spend" });
    }
    return res.json({ status: "saved", scope: "lifetime", customer: payload });
  }

  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getActiveMonthKey();
  if (!manualCustomers.monthly[month]) manualCustomers.monthly[month] = {};
  manualCustomers.monthly[month][key] = payload;
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not save customer spend" });
  }
  return res.json({ status: "saved", scope: "month", month, customer: payload });
});

app.post("/admin/customer-spend/delete", async (req, res) => {
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
      if (!(await saveData())) {
        return res.status(500).json({ status: "error", message: "Could not delete customer spend" });
      }
    }
    return res.json({ status: "deleted", scope: "lifetime" });
  }

  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getActiveMonthKey();
  if (manualCustomers.monthly && manualCustomers.monthly[month] && manualCustomers.monthly[month][key]) {
    delete manualCustomers.monthly[month][key];
    if (Object.keys(manualCustomers.monthly[month]).length === 0) {
      delete manualCustomers.monthly[month];
    }
    if (!(await saveData())) {
      return res.status(500).json({ status: "error", message: "Could not delete customer spend" });
    }
  }
  return res.json({ status: "deleted", scope: "month", month });
});

function handleResetCustomerMoney(req, res) {
  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getActiveMonthKey();

  let affected = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (getOrderReportingMonth(order) !== month) return;
    if (!order.excludeFromCustomerStats) {
      order.excludeFromCustomerStats = true;
      affected += 1;
    }
  });

  saveData();
  return res.json({ status: "reset", month, affected });
}

function handleResetProfit(req, res) {
  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getActiveMonthKey();

  let affected = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (getOrderReportingMonth(order) !== month) return;
    if (!order.excludeFromProfitStats) {
      order.excludeFromProfitStats = true;
      affected += 1;
    }
  });

  saveData();
  return res.json({ status: "reset", month, affected });
}

function calculateRawMonthProfit(month) {
  let monthProfit = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (getOrderReportingMonth(order) !== month) return;
    const orderProfitBase = Number.isFinite(Number(order.profit))
      ? Number(order.profit)
      : calculateOrderProfit(order);
    const orderProfit = isOrderExcludedFromProfitStats(order) ? 0 : orderProfitBase;
    monthProfit += orderProfit;
  });
  return monthProfit;
}

function calculateRawTotalProfit() {
  let totalProfit = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    const orderProfitBase = Number.isFinite(Number(order.profit))
      ? Number(order.profit)
      : calculateOrderProfit(order);
    const orderProfit = isOrderExcludedFromProfitStats(order) ? 0 : orderProfitBase;
    totalProfit += orderProfit;
  });
  return totalProfit;
}

function calculateRawMonthDeliveryProfit(month) {
  let monthDeliveryProfit = 0;
  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (getOrderReportingMonth(order) !== month) return;
    if (isOrderExcludedFromProfitStats(order)) return;
    if (String(order.mode || "").toLowerCase() !== "delivery") return;
    monthDeliveryProfit += Number(order.deliveryCharge) || 0;
  });
  return monthDeliveryProfit;
}

function handleSetMonthProfit(req, res) {
  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getActiveMonthKey();

  const desiredMonthProfit = Number(req.body?.desiredMonthProfit);
  if (!Number.isFinite(desiredMonthProfit)) {
    return res.status(400).json({ status: "error", message: "Invalid desiredMonthProfit" });
  }

  const rawMonthProfit = calculateRawMonthProfit(month);
  const adjustment = desiredMonthProfit - rawMonthProfit;
  monthProfitAdjustments[month] = adjustment;
  saveData();

  return res.json({
    status: "saved",
    month,
    rawMonthProfit,
    adjustment,
    monthProfit: rawMonthProfit + adjustment,
  });
}

app.post("/admin/reset-customer-money", handleResetCustomerMoney);
app.post("/reset-customer-money", handleResetCustomerMoney);
app.post("/admin/reset-profit", handleResetProfit);
app.post("/reset-profit", handleResetProfit);
app.post("/admin/set-month-profit", handleSetMonthProfit);
app.post("/set-month-profit", handleSetMonthProfit);

function handleSetTotalProfit(req, res) {
  const desiredTotalProfit = Number(req.body?.desiredTotalProfit);
  if (!Number.isFinite(desiredTotalProfit)) {
    return res.status(400).json({ status: "error", message: "Invalid desiredTotalProfit" });
  }

  const rawTotalProfit = calculateRawTotalProfit();
  totalProfitAdjustment = desiredTotalProfit - rawTotalProfit;
  saveData();

  return res.json({
    status: "saved",
    rawTotalProfit,
    adjustment: totalProfitAdjustment,
    totalProfit: rawTotalProfit + totalProfitAdjustment,
  });
}

function handleSetMonthDeliveryProfit(req, res) {
  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
    ? req.body.month
    : getActiveMonthKey();

  const desiredMonthDeliveryProfit = Number(req.body?.desiredMonthDeliveryProfit);
  if (!Number.isFinite(desiredMonthDeliveryProfit)) {
    return res.status(400).json({ status: "error", message: "Invalid desiredMonthDeliveryProfit" });
  }

  const rawMonthDeliveryProfit = calculateRawMonthDeliveryProfit(month);
  const adjustment = desiredMonthDeliveryProfit - rawMonthDeliveryProfit;
  monthDeliveryProfitAdjustments[month] = adjustment;
  saveData();

  return res.json({
    status: "saved",
    month,
    rawMonthDeliveryProfit,
    adjustment,
    monthDeliveryProfit: rawMonthDeliveryProfit + adjustment,
  });
}

app.post("/admin/set-month-delivery-profit", handleSetMonthDeliveryProfit);
app.post("/set-month-delivery-profit", handleSetMonthDeliveryProfit);
app.post("/admin/set-total-profit", handleSetTotalProfit);
app.post("/set-total-profit", handleSetTotalProfit);

app.get("/admin/month-state", (req, res) => {
  return res.json({ activeMonth: getActiveMonthKey() });
});

app.post("/admin/reset-month", async (req, res) => {
  const password = String(req.body?.password || "").trim();
  if (!isValidAdminPassword(password)) {
    return res.status(401).json({ status: "unauthorized", message: "Invalid password" });
  }

  const previousMonth = getActiveMonthKey();
  const nextMonth =
    typeof req.body?.nextMonth === "string" && /^\d{4}-\d{2}$/.test(req.body.nextMonth)
      ? req.body.nextMonth
      : getNextMonthKey(previousMonth);

  activeMonthKey = nextMonth;
  if (!(await saveData())) {
    return res.status(500).json({ status: "error", message: "Could not reset month" });
  }

  return res.json({ status: "reset", previousMonth, activeMonth: activeMonthKey });
});

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
    : getActiveMonthKey();

  const summary = {
    "104": { ordersCount: 0, totalAmount: 0, items: getDefaultProductMap(0) },
    "407": { ordersCount: 0, totalAmount: 0, items: getDefaultProductMap(0) },
    "607": { ordersCount: 0, totalAmount: 0, items: getDefaultProductMap(0) },
  };

  orders.forEach((order) => {
    if (isOrderCancelled(order)) return;
    if (getOrderReportingMonth(order) !== month) return;
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
app.get("/store-status", async (req, res) => {
  try {
    maybeRunAutoClose1230();
    const flags = await readStoreFlagsFromDb();
    if (flags) {
      storeClosed = !!flags.storeClosed;
      roomDeliveryBlocked = !!flags.roomDeliveryBlocked;
      autoCloseAt1230Enabled = !!flags.autoCloseAt1230Enabled;
      autoCloseLastRunDate = String(flags.autoCloseLastRunDate || "");
      closingSoonAlertEnabled = !!flags.closingSoonAlertEnabled;
      sleepingCallAlertEnabled = !!flags.sleepingCallAlertEnabled;
      outOfHostelAlertEnabled = !!flags.outOfHostelAlertEnabled;
      examDeliveryOffAlertEnabled = !!flags.examDeliveryOffAlertEnabled;
    }
  } catch (err) {
    console.error("Could not read store status from DB:", err);
  }
  res.json({
    closed: !!storeClosed,
    roomDeliveryBlocked: !!roomDeliveryBlocked,
    autoCloseAt1230Enabled: !!autoCloseAt1230Enabled,
    autoCloseLastRunDate: String(autoCloseLastRunDate || ""),
    closingSoonAlertEnabled: !!closingSoonAlertEnabled,
    sleepingCallAlertEnabled: !!sleepingCallAlertEnabled,
    outOfHostelAlertEnabled: !!outOfHostelAlertEnabled,
    examDeliveryOffAlertEnabled: !!examDeliveryOffAlertEnabled,
  });
});

// change status (admin)
app.post("/store-status", async (req, res) => {
  if (typeof req.body?.closed !== "boolean") {
    return res.status(400).json({ status: "error", message: "closed must be true/false" });
  }
  try {
    const persistedClosed = await persistStoreClosed(req.body.closed);
    storeClosed = persistedClosed;
    console.log("STORE STATUS:", storeClosed ? "CLOSED" : "open");
    return res.json({ status: "ok", closed: storeClosed });
  } catch (err) {
    console.error("Store status save failed:", err);
    return res.status(500).json({ status: "error", message: "Could not save store status" });
  }
});

app.get("/auto-close-status", (req, res) => {
  return res.json({
    autoCloseAt1230Enabled: !!autoCloseAt1230Enabled,
    autoCloseLastRunDate: String(autoCloseLastRunDate || ""),
  });
});

app.post("/auto-close-status", (req, res) => {
  if (typeof req.body?.autoCloseAt1230Enabled !== "boolean") {
    return res.status(400).json({ status: "error", message: "autoCloseAt1230Enabled must be true/false" });
  }
  autoCloseAt1230Enabled = !!req.body.autoCloseAt1230Enabled;
  saveData();
  return res.json({
    status: "ok",
    autoCloseAt1230Enabled,
    autoCloseLastRunDate: String(autoCloseLastRunDate || ""),
  });
});

app.get("/closing-alert-status", (req, res) => {
  return res.json({ closingSoonAlertEnabled: !!closingSoonAlertEnabled });
});

app.post("/closing-alert-status", (req, res) => {
  if (typeof req.body?.closingSoonAlertEnabled !== "boolean") {
    return res.status(400).json({ status: "error", message: "closingSoonAlertEnabled must be true/false" });
  }
  closingSoonAlertEnabled = !!req.body.closingSoonAlertEnabled;
  saveData();
  return res.json({ status: "ok", closingSoonAlertEnabled });
});

app.get("/sleeping-alert-status", (req, res) => {
  return res.json({ sleepingCallAlertEnabled: !!sleepingCallAlertEnabled });
});

app.post("/sleeping-alert-status", (req, res) => {
  if (typeof req.body?.sleepingCallAlertEnabled !== "boolean") {
    return res.status(400).json({ status: "error", message: "sleepingCallAlertEnabled must be true/false" });
  }
  sleepingCallAlertEnabled = !!req.body.sleepingCallAlertEnabled;
  saveData();
  return res.json({ status: "ok", sleepingCallAlertEnabled });
});

app.get("/out-of-hostel-alert-status", (req, res) => {
  return res.json({ outOfHostelAlertEnabled: !!outOfHostelAlertEnabled });
});

app.post("/out-of-hostel-alert-status", (req, res) => {
  if (typeof req.body?.outOfHostelAlertEnabled !== "boolean") {
    return res.status(400).json({ status: "error", message: "outOfHostelAlertEnabled must be true/false" });
  }
  outOfHostelAlertEnabled = !!req.body.outOfHostelAlertEnabled;
  saveData();
  return res.json({ status: "ok", outOfHostelAlertEnabled });
});

app.get("/exam-delivery-alert-status", (req, res) => {
  return res.json({ examDeliveryOffAlertEnabled: !!examDeliveryOffAlertEnabled });
});

app.post("/exam-delivery-alert-status", (req, res) => {
  if (typeof req.body?.examDeliveryOffAlertEnabled !== "boolean") {
    return res.status(400).json({ status: "error", message: "examDeliveryOffAlertEnabled must be true/false" });
  }
  examDeliveryOffAlertEnabled = !!req.body.examDeliveryOffAlertEnabled;
  saveData();
  return res.json({ status: "ok", examDeliveryOffAlertEnabled });
});

app.get("/delivery-status", (req, res) => {
  res.json({ roomDeliveryBlocked: !!roomDeliveryBlocked });
});

app.post("/delivery-status", (req, res) => {
  if (typeof req.body?.roomDeliveryBlocked !== "boolean") {
    return res.status(400).json({ status: "error", message: "roomDeliveryBlocked must be true/false" });
  }
  roomDeliveryBlocked = !!req.body.roomDeliveryBlocked;
  saveData();
  return res.json({ status: "ok", roomDeliveryBlocked });
});
    

const PORT = process.env.PORT || 5000;

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
    setInterval(() => {
      try {
        maybeRunAutoClose1230();
      } catch (err) {
        console.error("Auto-close scheduler error:", err);
      }
    }, 30000);
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
