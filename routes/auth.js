import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";

const router = express.Router();

// Función para generar JWT
const generarToken = (usuario) => {
    return jwt.sign(usuario, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES,
    });
};

/* ===============================
   GOOGLE LOGIN
================================ */
router.post("/google", async (req, res) => {
    const { code } = req.body;

    try {
        // 1. Intercambiar code por access_token
        const { data } = await axios.post("https://oauth2.googleapis.com/token", {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code,
            redirect_uri: `${process.env.FRONTEND_URL}/oauth/callback/google`,
            grant_type: "authorization_code",
        });

        // 2. Obtener info del usuario
        const userInfo = await axios.get(
            `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${data.access_token}`
        );

        const usuario = {
            nombre: userInfo.data.name,
            email: userInfo.data.email,
            proveedor: "google",
        };

        // 3. Generar JWT
        const token = generarToken(usuario);

        res.json({ token, usuario });
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Error con Google" });
    }
});

/* ===============================
   GITHUB LOGIN
================================ */
router.post("/github", async (req, res) => {
    const { code } = req.body;

    try {
        // 1. Intercambiar code por access_token
        const { data } = await axios.post(
            "https://github.com/login/oauth/access_token",
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: "http://localhost:5173/oauth/callback/github",
            },
            { headers: { Accept: "application/json" } }
        );

        // 2. Obtener info del usuario
        const userInfo = await axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${data.access_token}` },
        });

        const emails = await axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${data.access_token}` },
        });

        const usuario = {
            nombre: userInfo.data.name || userInfo.data.login,
            email: emails.data.find((e) => e.primary)?.email || "sin-email",
            proveedor: "github",
        };

        // 3. Generar JWT
        const token = generarToken(usuario);

        res.json({ token, usuario });
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Error con GitHub" });
    }
});

/* ===============================
   LINKEDIN LOGIN
================================ */
router.post("/linkedin", async (req, res) => {
    const { code } = req.body;

    try {
        // 1. Intercambiar code por access_token
        const { data } = await axios.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            null,
            {
                params: {
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: "http://localhost:5173/oauth/callback/linkedin",
                    client_id: process.env.LINKEDIN_CLIENT_ID,
                    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
                },
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }
        );

        const accessToken = data.access_token;

        // 2. Obtener info básica del usuario
        const profile = await axios.get(
            "https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)",
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        // 3. Obtener email del usuario
        const emailRes = await axios.get(
            "https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))",
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        const usuario = {
            nombre: `${profile.data.localizedFirstName} ${profile.data.localizedLastName}`,
            email: emailRes.data.elements[0]["handle~"].emailAddress,
            proveedor: "linkedin",
        };

        // 4. Generar JWT
        const token = generarToken(usuario);

        res.json({ token, usuario });
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Error con LinkedIn" });
    }
});

export default router;
