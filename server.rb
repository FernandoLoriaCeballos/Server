# const express = require('express');

# const express = require("express");
# const app = express();
# app.use(express.static("public"));

# const YOUR_DOMAIN = "http://localhost:5173"; // 👈 usa el mismo puerto que tu frontend (Vite)

# app.post("/create-checkout-session", async (req, res) => {
#   try {
#     const session = await stripe.checkout.sessions.create({
#       ui_mode: "custom",
#       line_items: [
#         {
#           price: "price_12345",
#           quantity: 1,
#         },
#       ],
#       mode: "payment",
#       return_url: `${YOUR_DOMAIN}/complete?session_id={CHECKOUT_SESSION_ID}`,
#     });

#     console.log("✅ Checkout Session creada:", session.id);
#     res.send(session.client_secret);
#   } catch (err) {
#     console.error("Error creando la sesión:", err);
#     res.status(500).send("Error al crear la sesión de pago.");
#   }
# });

# app.get("/session-status", async (req, res) => {
#   try {
#     const session = await stripe.checkout.sessions.retrieve(req.query.session_id, {
#       expand: ["payment_intent"],
#     });

#     res.send({
#       status: session.status,
#       payment_status: session.payment_status,
#       payment_intent_id: session.payment_intent?.id,
#       payment_intent_status: session.payment_intent?.status,
#     });
#   } catch (err) {
#     console.error("Error al obtener estado de sesión:", err);
#     res.status(500).send("Error al obtener estado de sesión.");
#   }
# });

# // 👇 Mantén tu puerto original
# app.listen(3000, () => console.log("Servidor corriendo en puerto 3000"));
# end