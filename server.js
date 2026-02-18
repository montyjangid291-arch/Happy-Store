const express = require("express");
const cors = require("cors");

// ===== GLOBAL STORE STOCK (ONLINE SAME FOR EVERY DEVICE) =====
let storeStock = {
Maggi:24,
Kurkure:9,
Bhujia:2,
Ariel:1,
"Bhoot Chips":5,
"Bingo Onion Chips":5
};

const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

let orders = [];

/* ---- HTML serve ---- */
app.use(express.static(__dirname));

// ===== GET STOCK =====
app.get("/stock",(req,res)=>{
res.json(storeStock);
});

// ===== UPDATE STOCK BY ADMIN =====
app.post("/stock",(req,res)=>{
storeStock=req.body;
console.log("Stock Updated:",storeStock);
res.json({status:"saved"});
});

/* ---- receive order ---- */
app.post("/order",(req,res)=>{
const order=req.body;

order.items.forEach(i=>{
if(storeStock[i.name]!==undefined){
storeStock[i.name]-=i.qty;
}
});


order.id=Date.now();
order.time=new Date().toLocaleString();

/* Delivery Text */
let deliveryText =
order.mode==="pickup"
? "SELF PICKUP"
: `ROOM DELIVERY (₹${order.deliveryCharge})`;

orders.push(order);

console.log("\n====== NEW ORDER ======");
console.log("Order ID:",order.id);
console.log("Name:",order.name);
console.log("Room:",order.room);
console.log("Hostel:",order.hostel);
console.log("Type:",deliveryText);

console.log("Items:");
order.items.forEach(i=>{
console.log(` - ${i.name} x${i.qty} = ₹${i.price*i.qty}`);
});

console.log("TOTAL: ₹"+order.total);
console.log("Time:",order.time);
console.log("=======================\n");

res.send({status:"ok"});
});


/* ---- send orders to admin ---- */
app.get("/orders", (req, res) => {
    res.json(orders);
});

app.listen(process.env.PORT || 5000, () => {console.log("Server running");

});
