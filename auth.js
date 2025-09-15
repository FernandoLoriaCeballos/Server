import express from "express";
import axios from "axios";

const router = express.Router();

router.post("/google", async (req, res) => {
    const { code } = req.body;

    try {
        const response = await axios.post("https://oauth2.googleapis.com/token", {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code,
            redirect_uri: "http://localhost:5173/oauth/callback/google", // o el de Vercel
            grant_type: "authorization_code",
        });

        res.json(response.data); // aquí ya tienes access_token y demás
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Error al intercambiar código con Google" });
    }
});

export default router;
