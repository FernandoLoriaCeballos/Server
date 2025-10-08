import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";

const router = express.Router();

const generarToken = (usuario) => {
    return jwt.sign(usuario, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES || "1h",
    });
};

router.post("/google/token", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Código no proporcionado" });

    try {
        const { data } = await axios.post("https://oauth2.googleapis.com/token", {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code,
            redirect_uri: `${process.env.FRONTEND_URL}`,
            grant_type: "authorization_code",
        });

        const userInfo = await axios.get(
            `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${data.access_token}`
        );

        const usuario = {
            nombre: userInfo.data.name,
            email: userInfo.data.email,
            proveedor: "google",
        };

        const token = generarToken(usuario);
        res.json({ token, usuario });
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Error con Google" });
    }
});

router.post("/oxxo-pay", async (req, res) => {
    // 1. Usa la clave secreta de tu pasarela (Conekta/Openpay)
    const privateKey = process.env.CONEKTA_PRIVATE_KEY;
    const api_url = "https://api.conekta.io/orders"; // URL de ejemplo para Conekta
    const { total, email } = req.body;

    if (!total || !email) {
        return res.status(400).json({ success: false, error: "Datos de pago requeridos." });
    }

    try {
        const orderData = {
            currency: "MXN",
            customer_info: { email: email },
            charges: [{
                amount: Math.round(parseFloat(total) * 100),
                payment_method: {
                    type: "oxxo_cash",
                },
            }],
        };

        const { data } = await axios.post(
            api_url,
            orderData,
            {
                headers: {
                    "Authorization": `Bearer ${privateKey}`,
                    "Content-Type": "application/json",
                    "Conekta-Version": "2.1.0",
                }
            }
        );

        // Extraer la referencia y fecha de expiración
        const oxxoCharge = data.charges.data[0];
        const oxxoReference = oxxoCharge.payment_method.reference;
        const expirationDate = new Date(oxxoCharge.payment_method.expires_at * 1000).toLocaleString();

        res.json({
            success: true,
            reference: oxxoReference,
            expirationDate: expirationDate,
        });

    } catch (error) {
        console.error("Error al generar pago OXXO:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: "Error al procesar el pago OXXO." });
    }
});

export default router;
