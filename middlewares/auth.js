import jwt from "jsonwebtoken";

export const verificarToken = (req, res, next) => {
    const token = req.headers["authorization"]?.split(" ")[1];

    if (!token) return res.status(403).json({ message: "Token requerido" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // guardamos info del usuario
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token inválido o expirado" });
    }
};
