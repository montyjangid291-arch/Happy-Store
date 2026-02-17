const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

let orders = [];

/* ---- HTML serve ---- */
app.use(express.static(__dirname));

/* ---- receive order ---- */
app.post("/order",(req,res)=>{
const order=req.body;

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

app.listen(5000, () => console.log("Server running → http://localhost:5000"));
