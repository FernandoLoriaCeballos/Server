import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from 'dotenv';
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import multer from "multer";
import Stripe from "stripe"; // Importación movida arriba para orden
import os from "os";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

dotenv.config(); // Siempre al inicio;
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://reviere-nube.vercel.app',
    'https://025175db.us2a.app.preset.io',
    'https://server-pi-black.vercel.app',
    '*' // Temporal
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// Inicializar Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
// Usa la variable de Vercel en producción, o localhost en tu PC
const baseUrl = "https://reviere-nube.vercel.app";

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { productos } = req.body; 

    // Validación básica
    if (!productos || productos.length === 0) {
      return res.status(400).json({ error: "No hay productos para procesar" });
    }

    const lineItems = productos.map((item) => {
      return {
        price_data: {
          currency: "mxn",
          product_data: {
            name: item.nombre,
            description: item.descripcion || "Sin descripción",
          },
          unit_amount: Math.round(item.precio * 100), // Stripe usa centavos
        },
        quantity: item.cantidad,
      };
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${baseUrl}/landing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Error en Stripe:", error);
    res.status(500).json({ error: error.message });
  }
});

const generarToken = (usuario) => {
  return jwt.sign(usuario, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES || "1h",
  });
};

app.use("/auth", authRoutes);

app.use(express.static('dist', {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// --- START: uploads + multer setup ---
// Permitir override via env (por ejemplo en producción configurar un bucket o /tmp)
let UPLOADS_BASE = process.env.UPLOADS_BASE || path.join(process.cwd(), "uploads");
const COMPANY_UPLOADS = () => path.join(UPLOADS_BASE, "companies");
const PRODUCT_UPLOADS = () => path.join(UPLOADS_BASE, "products");

// Intentamos crear las carpetas; si fallamos (p. ej. Vercel /var/task es read-only)
try {
  fs.mkdirSync(COMPANY_UPLOADS(), { recursive: true });
  fs.mkdirSync(PRODUCT_UPLOADS(), { recursive: true });
} catch (err) {
  console.warn("⚠️ No se pudo crear uploads en", UPLOADS_BASE, "-> fallback a temp dir:", err.code);
  const tmpUploads = path.join(os.tmpdir(), "uploads");
  try {
    fs.mkdirSync(path.join(tmpUploads, "companies"), { recursive: true });
    fs.mkdirSync(path.join(tmpUploads, "products"), { recursive: true });
    UPLOADS_BASE = tmpUploads;
    console.warn("ℹ️ Usando uploads temporal:", UPLOADS_BASE);
  } catch (err2) {
    console.error("❌ No se pudo crear la carpeta temporal para uploads:", err2);
    // No rompemos el arranque; multer seguirá fallando al subir pero servidor no se cae
  }
}

// Servir archivos estáticos desde el path final elegido
app.use("/uploads", express.static(UPLOADS_BASE));
console.log("📁 Uploads path:", UPLOADS_BASE);
// --- END: uploads + multer setup ---

// ===== FUNCIONES AUXILIARES =====
const makeFilename = (originalName) => {
  const timestamp = Date.now();
  const safeName = originalName
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\.-]/g, "");
  return `${timestamp}_${safeName}`;
};

// ===== CONFIGURAR MULTER PARA LOGOS =====
const companyStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, COMPANY_UPLOADS()),
  filename: (req, file, cb) => cb(null, makeFilename(file.originalname)),
});
const uploadCompany = multer({ storage: companyStorage });

// ===== ENDPOINT: REGISTRO DE EMPRESA + LOGO =====
app.post(
  "/registro/empresa",
  uploadCompany.fields([{ name: "logo", maxCount: 1 }]),
  async (req, res) => {
    try {
      const { nombre_empresa, email, password, descripcion, telefono, logoStr } = req.body;

      if (!nombre_empresa || !email || !password) {
        return res.status(400).json({ message: "Faltan datos obligatorios (nombre_empresa, email, password)" });
      }

      let logoFilename = null;

      if (req.files && req.files.logo && req.files.logo.length > 0) {
        logoFilename = req.files.logo[0].filename;
      } else if (logoStr && typeof logoStr === "string" && logoStr.trim()) {
        const v = logoStr.trim();
        if (/^https?:\/\//i.test(v)) {
          try {
            logoFilename = path.basename(new URL(v).pathname);
          } catch {
            logoFilename = path.basename(v);
          }
        } else if (v.includes("/uploads/")) {
          logoFilename = path.basename(v);
        } else {
          logoFilename = v;
        }
      }

      const nuevaEmpresa = await Empresa.create({
        nombre_empresa,
        email,
        password,
        descripcion,
        telefono,
        logo: logoFilename, 
      });

      const logoUrlPublic = logoFilename
        ? `${req.protocol}://${req.get("host")}/uploads/companies/${logoFilename}`
        : null;

      res.status(201).json({
        message: "Empresa registrada correctamente",
        empresa: nuevaEmpresa,
        logoFilename,
        logoUrl: logoUrlPublic
      });
    } catch (error) {
      console.error("Error registrando empresa:", error);
      res.status(500).json({ message: "Error al registrar empresa" });
    }
  }
);

// ===== ENDPOINT: SUBIDA DE FOTO DE PRODUCTO (opcional) =====
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRODUCT_UPLOADS()),
  filename: (req, file, cb) => cb(null, makeFilename(file.originalname)),
});

const uploadProduct = multer({ storage: productStorage });

app.post("/upload/product-photo/:id_producto?", uploadProduct.single("foto"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded (field name: foto)" });

    const relativePath = `/uploads/products/${req.file.filename}`;
    const { id_producto } = req.params;

    if (id_producto) {
      const producto = await Producto.findOneAndUpdate(
        { id_producto: parseInt(id_producto) },
        { foto: relativePath },
        { new: true }
      );
      if (!producto)
        return res.status(404).json({ message: "Producto no encontrado" });
      return res
        .status(200)
        .json({ message: "Foto subida y producto actualizado", producto });
    }

    res.status(201).json({ message: "Foto de producto subida", fotoUrl: relativePath });
  } catch (error) {
    console.error("Error subiendo foto:", error);
    res.status(500).json({ message: "Error en la subida" });
  }
});

app.all("/upload/*", (req, res) => {
  res.status(404).json({ message: "Upload endpoint not found" });
});

// Conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/proyectitos_dev";

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Conectado exitosamente a MongoDB");
  })
  .catch((error) => {
    console.error("Error de conexión a MongoDB:", error.message || error);
  });

// --- SCHEMAS Y MODELOS ---

// 1. MODIFICACIÓN: Agregar trial_end al usuario
const usuarioSchema = new mongoose.Schema({
  id_usuario: Number,
  nombre: String,
  email: String,
  password: String,
  rol: {
    type: String,
    enum: ["superadmin", "admin_empresa", "empleado", "usuario"],
    default: "usuario"
  },
  id_empresa: Number, 
  fecha_reg: { type: Date, default: Date.now },
  // NUEVO CAMPO PARA PRUEBA GRATIS
  trial_end: { type: Date } 
});

const empresaSchema = new mongoose.Schema({
  id_empresa: Number,
  nombre_empresa: String, 
  email: String,
  password: String,
  descripcion: String,
  telefono: String,
  logo: String,
  fecha_creacion: { type: Date, default: Date.now }
});
const Empresa = mongoose.model("Empresa", empresaSchema, "empresas");

const contadorEmpresaSchema = new mongoose.Schema({
  _id: { type: String, default: "id_empresa" }, 
  sequence_value: { type: Number, default: 0 }
});
const ContadorEmpresa = mongoose.model("ContadorEmpresa", contadorEmpresaSchema, "contadorEmpresa");

const empleadoSchema = new mongoose.Schema({
  id_empleado: Number,
  nombre: String,
  email: String,
  password: String,
  id_empresa: Number, 
  fecha_reg: { type: Date, default: Date.now }
});
const Empleado = mongoose.model("Empleado", empleadoSchema, "empleados");

const productoSchema = new mongoose.Schema({
  id_producto: Number,
  nombre: String,
  descripcion: String,
  precio: Number,
  precio_original: Number,
  en_oferta: { type: Boolean, default: false },
  stock: Number,
  categoria: String,
  foto: String,
  id_empresa: { 
    type: Number,
    required: true 
  },
  fecha_reg: { type: Date, default: Date.now },
});
const Producto = mongoose.model("Producto", productoSchema, "productos");

const contadorProductoSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});
const ContadorProducto = mongoose.model("ContadorProducto", contadorProductoSchema, "contadorProductos");

const ofertaSchema = new mongoose.Schema({
  id_oferta: Number,
  id_producto: Number,
  descuento: Number,
  precio_oferta: Number,
  fecha_inicio: Date,
  fecha_fin: Date,
  estado: { type: Boolean, default: true }
});
const Oferta = mongoose.model("Oferta", ofertaSchema, "ofertas");

const contadorOfertaSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});
const ContadorOferta = mongoose.model("ContadorOferta", contadorOfertaSchema, "contadorOfertas");

// --- RUTAS DE PRODUCTOS ---

app.post("/productos", uploadProduct.single('foto'), async (req, res) => {
  const { nombre, descripcion, precio, stock, categoria, id_empresa } = req.body;
  const foto = req.file ? req.file.filename : null;
  
  if (!id_empresa) {
    return res.status(400).json({ message: "El id_empresa es requerido" });
  }

  try {
    const contador = await ContadorProducto.findByIdAndUpdate(
      "id_producto",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const nuevoProducto = new Producto({
      id_producto: contador.sequence_value,
      nombre,
      descripcion,
      precio,
      precio_original: null,
      en_oferta: false,
      stock,
      categoria,
      foto, 
      id_empresa: parseInt(id_empresa)
    });

    await nuevoProducto.save();
    res.status(201).json({ 
      message: "Producto agregado exitosamente",
      foto: foto ? `/uploads/${foto}` : null 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/productos", async (req, res) => {
  try {
    const { id_empresa } = req.query; 
    let query = {};
    if (id_empresa) {
      query.id_empresa = parseInt(id_empresa);
    }
    const productos = await Producto.find(query);
    res.status(200).json(productos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/productos/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, precio, stock, categoria, foto } = req.body;
  try {
    const productoActualizado = await Producto.findByIdAndUpdate(
      id,
      { nombre, descripcion, precio, stock, categoria, foto },
      { new: true }
    );
    res.status(200).json(productoActualizado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/productos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await Producto.findByIdAndDelete(id);
    res.status(200).json({ message: "Producto eliminado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- RUTAS DE OFERTAS ---

app.post("/ofertas", async (req, res) => {
  const { id_producto, descuento, precio_oferta, fecha_inicio, fecha_fin, estado } = req.body;
  try {
    const producto = await Producto.findOne({ id_producto });
    if (!producto) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const contador = await ContadorOferta.findByIdAndUpdate(
      "id_oferta",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const nuevaOferta = new Oferta({
      id_oferta: contador.sequence_value,
      id_producto,
      descuento,
      precio_oferta,
      fecha_inicio: new Date(fecha_inicio),
      fecha_fin: new Date(fecha_fin),
      estado
    });

    await nuevaOferta.save();

    await Producto.findOneAndUpdate(
      { id_producto },
      { en_oferta: true }
    );

    res.status(201).json({ message: "Oferta creada exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/ofertas", async (req, res) => {
  try {
    const ofertas = await Oferta.find();
    const ofertasConProductos = await Promise.all(ofertas.map(async (oferta) => {
      const producto = await Producto.findOne({ id_producto: oferta.id_producto });
      return {
        ...oferta.toObject(),
        nombre_producto: producto ? producto.nombre : "Producto no encontrado"
      };
    }));
    res.status(200).json(ofertasConProductos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/ofertas/:id", async (req, res) => {
  const { id } = req.params;
  const { id_producto, descuento, precio_oferta, fecha_inicio, fecha_fin, estado } = req.body;
  try {
    const ofertaActualizada = await Oferta.findByIdAndUpdate(
      id,
      {
        id_producto,
        descuento,
        precio_oferta,
        fecha_inicio: new Date(fecha_inicio),
        fecha_fin: new Date(fecha_fin),
        estado
      },
      { new: true }
    );

    await Producto.findOneAndUpdate(
      { id_producto },
      { en_oferta: estado }
    );

    res.status(200).json(ofertaActualizada);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/ofertas/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const oferta = await Oferta.findById(id);
    if (oferta) {
      await Producto.findOneAndUpdate(
        { id_producto: oferta.id_producto },
        {
          precio: oferta.precio_original, 
          precio_original: null,
          en_oferta: false
        }
      );
    }

    await Oferta.findByIdAndDelete(id);
    res.status(200).json({ message: "Oferta eliminada exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

const verificarOfertasVencidas = async () => {
  try {
    const ofertasVencidas = await Oferta.find({
      fecha_fin: { $lt: new Date() },
      estado: true
    });

    for (const oferta of ofertasVencidas) {
      await Oferta.findByIdAndUpdate(
        oferta._id,
        { estado: false }
      );

      const producto = await Producto.findOne({ id_producto: oferta.id_producto });
      if (producto && producto.precio_original) {
        await Producto.findOneAndUpdate(
          { id_producto: oferta.id_producto },
          {
            precio: producto.precio_original,
            precio_original: null,
            en_oferta: false
          }
        );
      }
    }
  } catch (error) {
    console.error('Error al verificar ofertas vencidas:', error);
  }
};
setInterval(verificarOfertasVencidas, 3600000); 

const Usuario = mongoose.model("Usuario", usuarioSchema, "usuarios");
const contadorSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});
const Contador = mongoose.model("Contador", contadorSchema, "contadores");

// --- RUTAS DE USUARIOS Y AUTH ---

// 2. MODIFICACIÓN: Asignar 15 días de prueba al registrarse
app.post("/registro", async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    const contador = await Contador.findByIdAndUpdate(
      "id_usuario",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    // Calcular fecha de fin de prueba (Hoy + 15 días)
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 15);

    const nuevoUsuario = new Usuario({
      id_usuario: contador.sequence_value,
      nombre,
      email,
      password,
      rol: "usuario", 
      trial_end: trialEndDate // Guardar fecha de fin de prueba
    });

    await nuevoUsuario.save();
    res.status(201).json({ message: "Usuario registrado exitosamente con 15 días de prueba" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/registro/usuarios-superadmin", async (req, res) => {
  const { nombre, email, password, rol, id_empresa } = req.body;
  const rolSolicitante = req.headers["rol"];

  if (rolSolicitante !== "superadmin") {
    return res.status(403).json({ message: "Acceso denegado. Solo el SuperAdmin puede registrar usuarios con rol personalizado." });
  }

  const rolesPermitidos = ["superadmin", "admin_empresa", "empleado", "usuario"];
  if (!rolesPermitidos.includes(rol)) {
    return res.status(400).json({ message: "Rol no válido." });
  }

  try {
    const contador = await Contador.findByIdAndUpdate(
      "id_usuario",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const nuevoUsuario = new Usuario({
      id_usuario: contador.sequence_value,
      nombre,
      email,
      password,
      rol,
      ...(rol === "admin_empresa" || rol === "empleado" ? { id_empresa: parseInt(id_empresa) } : {})
    });

    await nuevoUsuario.save();
    res.status(201).json({ message: "Usuario creado exitosamente por SuperAdmin" });
  } catch (error) {
    console.error("Error al registrar usuario (superadmin):", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.post("/registro/empleados-empresa", async (req, res) => {
  const rolSolicitante = req.headers["rol"];
  const empresaId = req.headers["empresa_id"]; 

  if (rolSolicitante !== "admin_empresa") {
    return res.status(403).json({ message: "Acceso denegado. Solo administradores de empresa pueden registrar empleados." });
  }

  const { nombre, email, password } = req.body;

  try {
    const contador = await Contador.findByIdAndUpdate(
      "id_usuario",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const nuevoEmpleado = new Usuario({
      id_usuario: contador.sequence_value,
      nombre,
      email,
      password,
      rol: "empleado",
      empresa_id: parseInt(empresaId)
    });

    await nuevoEmpleado.save();
    res.status(201).json({ message: "Empleado registrado exitosamente por Admin de Empresa" });
  } catch (error) {
    console.error("Error al registrar empleado:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});
 
app.post(
  "/registro/empresa",
  uploadCompany.fields([{ name: "logo", maxCount: 1 }]), 
  async (req, res) => {
    try {
      const { nombre_empresa, email, password, descripcion, telefono, logoStr } = req.body;

      if (!nombre_empresa || !email || !password) {
        return res.status(400).json({
          message: "Faltan datos obligatorios (nombre_empresa, email, password)",
        });
      }

      let logoFilename = null;

      if (req.files && req.files.logo && req.files.logo.length > 0) {
        logoFilename = req.files.logo[0].filename;
      } else if (logoStr && typeof logoStr === "string" && logoStr.trim()) {
        const v = logoStr.trim();
        if (/^https?:\/\//i.test(v)) {
          try {
            logoFilename = path.basename(new URL(v).pathname);
          } catch {
            logoFilename = path.basename(v);
          }
        } else if (v.includes("/uploads/")) {
          logoFilename = path.basename(v);
        } else {
          logoFilename = v; 
        }
      }

      const nuevaEmpresa = await Empresa.create({
        nombre_empresa,
        email,
        password,
        descripcion,
        telefono,
        logo: logoFilename, 
      });

      const logoUrlPublic = logoFilename
        ? `${req.protocol}://${req.get("host")}/uploads/companies/${logoFilename}`
        : null;

      res.status(201).json({
        message: "Empresa registrada correctamente",
        empresa: nuevaEmpresa,
        logoFilename,
        logoUrl: logoUrlPublic, 
      });
    } catch (error) {
      console.error("Error registrando empresa:", error);
      res.status(500).json({ message: "Error al registrar empresa" });
    }
  }
);

app.post("/empresas", uploadCompany.single("logo"), async (req, res) => {
  try {
    const { nombre_empresa, email, password, descripcion, telefono } = req.body;

    const contador = await ContadorEmpresa.findByIdAndUpdate(
      "id_empresa",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const logoFilename = req.file ? req.file.filename : null;

    const nuevaEmpresa = new Empresa({
      id_empresa: contador.sequence_value,
      nombre_empresa,
      email,
      password,
      descripcion,
      telefono,
      logo: logoFilename, 
      fecha_creacion: new Date(),
    });

    await nuevaEmpresa.save();

    const logoUrlPublic = logoFilename
      ? `${req.protocol}://${req.get("host")}/uploads/companies/${logoFilename}`
      : null;

    res.status(201).json({
      message: "Empresa creada exitosamente",
      empresa: nuevaEmpresa,
      logoFilename,
      logoUrl: logoUrlPublic,
    });
  } catch (error) {
    console.error("Error al crear empresa:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.use("/uploads", express.static(path.join("uploads")));

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuario = await Usuario.findOne({ email });

    if (!usuario || usuario.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const response = {
      id_usuario: usuario.id_usuario,
      nombre: usuario.nombre,
      rol: usuario.rol,
      message: `¡Bienvenido ${usuario.nombre}!`
    };

    if (usuario.rol === "admin_empresa" || usuario.rol === "empleado") {
      response.empresa_id = usuario.id_empresa;  
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/login/empresa", async (req, res) => {
  try {
    const { nombre_empresa, password } = req.body;

    const empresa = await Empresa.findOne({ nombre_empresa });

    if (!empresa || empresa.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    res.status(200).json({
      id_empresa: empresa.id_empresa,
      nombre: empresa.nombre_empresa,
      message: `¡Bienvenido ${empresa.nombre_empresa}!`
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/login/empleado", async (req, res) => {
  try {
    const { email, password, id_empresa } = req.body;

    const empleado = await Empleado.findOne({ email });

    if (!empleado || empleado.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    if (id_empresa && empleado.id_empresa !== parseInt(id_empresa)) {
      return res.status(403).json({ message: "Este empleado no pertenece a la empresa logueada." });
    }

    const empresa = await Empresa.findOne({ id_empresa: empleado.id_empresa });

    if (!empresa) {
      return res.status(403).json({ message: "Este empleado no está asociado a ninguna empresa válida." });
    }

    res.status(200).json({
      id_empleado: empleado.id_empleado,
      nombre: empleado.nombre,
      id_empresa: empresa.id_empresa,
      rol: "empleado",
      message: `¡Bienvenido ${empleado.nombre} de ${empresa.nombre_empresa || empresa.nombre}!`
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/usuarios", async (req, res) => {
  try {
    const usuarios = await Usuario.find();
    res.status(200).json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/empresas", async (req, res) => {
  try {
    const empresas = await Empresa.find();
    res.status(200).json(empresas);
  } catch (error) {
    console.error("Error al obtener empresas:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/empresas", async (req, res) => {
  try {
    const { nombre_empresa, email, password, descripcion, telefono, logo } = req.body;

    const contador = await ContadorEmpresa.findByIdAndUpdate(
      "id_empresa",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const nuevaEmpresa = new Empresa({
      id_empresa: contador.sequence_value,
      nombre_empresa,
      email,
      password,
      descripcion,
      telefono,
      logo,
      fecha_creacion: new Date()
    });

    await nuevaEmpresa.save();
    res.status(201).json({ message: "Empresa creada exitosamente", empresa: nuevaEmpresa });
  } catch (error) {
    console.error("Error al crear empresa:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/empresas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_empresa, email, password, descripcion, telefono, logo } = req.body;

    const empresaActualizada = await Empresa.findByIdAndUpdate(
      id,
      { nombre_empresa, email, password, descripcion, telefono, logo },
      { new: true }
    );

    if (!empresaActualizada) {
      return res.status(404).json({ message: "Empresa no encontrada" });
    }

    res.status(200).json({ message: "Empresa actualizada exitosamente", empresa: empresaActualizada });
  } catch (error) {
    console.error("Error al actualizar empresa:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/empresas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const empresaEliminada = await Empresa.findByIdAndDelete(id);

    if (!empresaEliminada) {
      return res.status(404).json({ message: "Empresa no encontrada" });
    }

    res.status(200).json({ message: "Empresa eliminada exitosamente" });
  } catch (error) {
    console.error("Error al eliminar empresa:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/finalizar-compra-stripe", async (req, res) => {
  const { id_usuario } = req.body;

  try {
    // 1. Buscamos el carrito del usuario
    const carrito = await Carrito.findOne({ id_usuario: parseInt(id_usuario) });
    
    if (!carrito || carrito.productos.length === 0) {
      return res.status(200).json({ message: "Compra realizada con éxito " });
    }

    
    for (const item of carrito.productos) {
      await Producto.findOneAndUpdate(
        { id_producto: item.id_producto },
        { $inc: { stock: -item.cantidad } } // Restamos la cantidad comprada
      );
    }

    carrito.productos = [];
    carrito.cupon_aplicado = null;
    await carrito.save();

    res.status(200).json({ message: "Compra finalizada: Stock actualizado y carrito vaciado." });

  } catch (error) {
    console.error("Error al finalizar compra Stripe:", error);
    res.status(500).json({ message: "Error en el servidor al procesar la compra" });
  }
});

app.get("/empleados/empresa/:empresa_id", async (req, res) => {
  const { empresa_id } = req.params;

  try {
    const empresaIdNum = parseInt(empresa_id);

    const empleadosDirectos = await Empleado.find({ id_empresa: empresaIdNum });

    const empleadosUsuarios = await Usuario.find({
      rol: { $in: ["empleado", "admin_empresa"] },
      id_empresa: empresaIdNum
    });

    const todosLosEmpleados = [...empleadosDirectos, ...empleadosUsuarios];

    res.status(200).json(todosLosEmpleados);
  } catch (error) {
    console.error("Error al obtener empleados:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/todos-usuarios-empleados", async (req, res) => {
  try {
    const [usuarios, empleados, empresas] = await Promise.all([
      Usuario.find(),
      Empleado.find(),
      Empresa.find()
    ]);

    const empresaMap = {};
    empresas.forEach(e => {
      empresaMap[e.id_empresa] = e.nombre_empresa;
    });

    const usuariosNormalizados = usuarios.map(u => ({
      ...u._doc,
      tipo: "usuario",
      empresa_id: u.id_empresa || null,
      empresa_nombre: u.id_empresa ? empresaMap[u.id_empresa] || "Empresa no encontrada" : "Sin empresa"
    }));

    const empleadosNormalizados = empleados.map(e => ({
      ...e._doc,
      tipo: "empleado",
      empresa_id: e.id_empresa || null,
      empresa_nombre: e.id_empresa ? empresaMap[e.id_empresa] || "Empresa no encontrada" : "Sin empresa"
    }));

    res.status(200).json([...usuariosNormalizados, ...empleadosNormalizados]);
  } catch (error) {
    console.error("Error al obtener todos los usuarios y empleados:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, email, password, rol, empresa_id } = req.body;

  try {
    const updateFields = {
      nombre,
      email,
      password,
      rol,
    };

    if (rol === "empleado" || rol === "admin_empresa") {
      updateFields.id_empresa = empresa_id ? parseInt(empresa_id) : null;
    } else {
      updateFields.id_empresa = null;
    }

    const usuarioActualizado = await Usuario.findByIdAndUpdate(
      id,
      updateFields,
      { new: true }
    );

    res.status(200).json(usuarioActualizado);
  } catch (error) {
    console.error("Error al actualizar usuario:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await Usuario.findByIdAndDelete(id);
    res.status(200).json({ message: "Usuario eliminado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- RESEÑAS ---

const resenaSchema = new mongoose.Schema({
  id_resena: Number,
  id_producto: Number,
  id_usuario: Number,
  calificacion: Number,
  comentario: String,
  fecha: { type: Date, default: Date.now },
});
const Resena = mongoose.model("Resena", resenaSchema, "resenas");

const contadorResenaSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});
const ContadorResena = mongoose.model("ContadorResena", contadorResenaSchema, "contadorResenas");

app.post("/resenas", async (req, res) => {
  const { id_producto, id_usuario, calificacion, comentario, fecha } = req.body;

  if (!calificacion || !comentario) {
    res.status(400).json({ message: "Calificación y comentario son campos requeridos para la reseña." });
    return;
  }
  try {
    const contador = await ContadorResena.findByIdAndUpdate(
      "id_resena",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );
    const nuevaResena = new Resena({
      id_resena: contador.sequence_value,
      id_producto,
      id_usuario,
      calificacion,
      comentario,
      fecha: fecha ? new Date(fecha) : Date.now()
    });
    await nuevaResena.save();
    res.status(201).json({ message: "Reseña agregada exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/resenas", async (req, res) => {
  try {
    const resenas = await Resena.find();
    res.status(200).json(resenas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/resenas/:id", async (req, res) => {
  const { id } = req.params;
  const { id_producto, id_usuario, calificacion, comentario, fecha } = req.body;
  try {
    const resenaActualizada = await Resena.findByIdAndUpdate(
      id,
      { id_producto, id_usuario, calificacion, comentario, fecha },
      { new: true }
    );
    res.status(200).json(resenaActualizada);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/resenas/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await Resena.findByIdAndDelete(id);
    res.status(200).json({ message: "Reseña eliminada exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- RECIBOS Y CARRITOS ---

const reciboSchema = new mongoose.Schema({
  id_recibo: Number,
  id_compra: Number,
  id_usuario: Number,
  id_empresa: Number,
  fecha_emi: { type: Date, default: Date.now },
  detalle: String,
  precio_total: Number,
});
const Recibo = mongoose.model("Recibo", reciboSchema, "recibos");

const contadorReciboSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});
const ContadorRecibo = mongoose.model("ContadorRecibo", contadorReciboSchema, "contadorRecibos");

app.get("/recibos", async (req, res) => {
  try {
    const recibos = await Recibo.find();
    const recibosConDetalles = await Promise.all(recibos.map(async (recibo) => {
      const usuario = await Usuario.findOne({ id_usuario: recibo.id_usuario });
      return {
        ...recibo.toObject(),
        nombre_usuario: usuario ? usuario.nombre : "Usuario no encontrado"
      };
    }));
    res.status(200).json(recibosConDetalles);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.get("/recibos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const recibo = await Recibo.findOne({ id_recibo: id });
    if (recibo) {
      res.status(200).json(recibo);
    } else {
      res.status(404).json({ message: "Recibo no encontrado" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/recibos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await Recibo.findOneAndDelete({ id_recibo: id });
    res.status(200).json({ message: "Recibo eliminado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// ====================================================================
// RUTA POST PARA PAGOS DIRECTOS (PayPal / Oxxo / Efectivo) - BLINDADA
// ====================================================================
app.post("/recibos", async (req, res) => {
  const { id_usuario, productos, cupon_aplicado, total } = req.body;
  console.log("🔵 Iniciando proceso de compra directa (PayPal)...");

  try {
    const contador = await ContadorRecibo.findByIdAndUpdate(
      "id_recibo",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const productosDisponibles = await Producto.find();

    const detalle = productos.map((producto) => {
      const nombreProducto =
        productosDisponibles.find((p) => p.id_producto === producto.id_producto)
          ?.nombre || "Producto no encontrado";
      return `${producto.cantidad} ${nombreProducto}`;
    }).join(", ");

    const nuevoRecibo = new Recibo({
      id_recibo: contador.sequence_value,
      id_compra: contador.sequence_value,
      id_usuario,
      fecha_emi: new Date(),
      detalle,
      precio_total: total,
    });

    await nuevoRecibo.save();

    // --- BLOQUE DE RESTA DE STOCK BLINDADO ---
    console.log("📉 Actualizando inventario...");
    for (const item of productos) {
      // Forzamos conversión a número para evitar errores de tipo
      const idProd = parseInt(item.id_producto);
      const cant = parseInt(item.cantidad);

      const resultado = await Producto.findOneAndUpdate(
        { id_producto: idProd }, 
        { $inc: { stock: -cant } }, // Restamos
        { new: true } // Para ver el resultado actualizado
      );

      if (resultado) {
        console.log(`✅ Producto ID ${idProd}: Stock bajó a ${resultado.stock}`);
      } else {
        console.log(`⚠️ Producto ID ${idProd} NO ENCONTRADO en la BD.`);
      }
    }
    // ------------------------------------------

    await Carrito.findOneAndUpdate(
      { id_usuario },
      { $set: { productos: [], cupon_aplicado: null } }
    );

    res.status(201).json({ message: "Recibo agregado exitosamente" });
  } catch (error) {
    console.error("❌ Error en /recibos:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- CATALOGO ---

const catalogoSchema = new mongoose.Schema({
  id_catalogo: Number,
  nombre: String,
  descripcion: String,
  fecha_act: { type: Date, default: Date.now },
  productos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Producto' }],
});

catalogoSchema.pre('save', function (next) {
  this.fecha_act = Date.now();
  next();
});

catalogoSchema.pre('findOneAndUpdate', function (next) {
  this._update.fecha_act = Date.now();
  next();
});

const Catalogo = mongoose.model('Catalogo', catalogoSchema, 'catalogo');

const contadorCatalogoSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

const ContadorCatalogo = mongoose.model('ContadorCatalogo', contadorCatalogoSchema, 'contadores_catalogo');

app.post('/catalogo', async (req, res) => {
  const { nombre, descripcion, productos } = req.body;
  try {
    const contador = await ContadorCatalogo.findByIdAndUpdate(
      'id_catalogo',
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const nuevoCatalogo = new Catalogo({
      id_catalogo: contador.sequence_value,
      nombre,
      descripcion,
      productos
    });
    await nuevoCatalogo.save();
    res.status(201).json(nuevoCatalogo);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

app.get('/catalogo', async (req, res) => {
  try {
    const catalogos = await Catalogo.find().populate('productos', 'nombre');
    res.status(200).json(catalogos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

app.put('/catalogo/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, productos } = req.body;
  try {
    const catalogoActualizado = await Catalogo.findByIdAndUpdate(
      id,
      { nombre, descripcion, productos },
      { new: true }
    ).populate('productos', 'nombre');
    res.status(200).json(catalogoActualizado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

app.delete('/catalogo/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await Catalogo.findByIdAndDelete(id);
    res.status(200).json({ message: 'Catálogo eliminado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// --- CARRITOS ---

const carritoSchema = new mongoose.Schema({
  id_usuario: Number,
  productos: [
    {
      id_producto: Number,
      cantidad: Number,
      nombre: String,
      precio: Number,
      foto: String,
      esPromocion: Boolean
    },
  ],
  cupon_aplicado: {
    codigo: String,
    descuento: Number
  }
});
const Carrito = mongoose.model("Carrito", carritoSchema, "carritos");

app.get("/carrito/:id_usuario", async (req, res) => {
  const { id_usuario } = req.params;
  try {
    let carrito = await Carrito.findOne({ id_usuario: parseInt(id_usuario) });
    if (!carrito) {
      carrito = new Carrito({
        id_usuario: parseInt(id_usuario),
        productos: [],
        cupon_aplicado: null
      });
      await carrito.save();
    }
    res.status(200).json(carrito);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/carrito/:id_usuario", async (req, res) => {
  const { id_usuario } = req.params;
  const { productos, cupon_aplicado } = req.body;

  try {
    const carritoActualizado = await Carrito.findOneAndUpdate(
      { id_usuario: parseInt(id_usuario) },
      {
        $set: {
          productos: productos,
          cupon_aplicado: cupon_aplicado
        }
      },
      { new: true, upsert: true }
    );

    res.status(200).json(carritoActualizado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/carrito/:id_usuario", async (req, res) => {
  const { id_usuario } = req.params;
  const { id_producto, cantidad, nombre, precio, foto, esPromocion } = req.body;

  try {
    const carrito = await Carrito.findOne({ id_usuario: parseInt(id_usuario) });

    if (!carrito) {
      const nuevoCarrito = new Carrito({
        id_usuario: parseInt(id_usuario),
        productos: [{
          id_producto,
          cantidad,
          nombre,
          precio,
          foto,
          esPromocion 
        }],
        cupon_aplicado: null
      });
      await nuevoCarrito.save();
      return res.status(201).json(nuevoCarrito);
    }

    const productoExistente = carrito.productos.find(p => p.id_producto === id_producto);

    if (productoExistente) {
      productoExistente.cantidad += cantidad;
    } else {
      carrito.productos.push({
        id_producto,
        cantidad,
        nombre,
        precio,
        foto,
        esPromocion 
      });
    }

    await carrito.save();
    res.status(200).json(carrito);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/carrito/:id_usuario/:id_producto", async (req, res) => {
  const { id_usuario, id_producto } = req.params;

  try {
    const carrito = await Carrito.findOne({ id_usuario: parseInt(id_usuario) });

    if (!carrito) {
      return res.status(404).json({ message: "Carrito no encontrado" });
    }

    carrito.productos = carrito.productos.filter(p => p.id_producto !== parseInt(id_producto));
    await carrito.save();

    res.status(200).json(carrito);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/carrito/:id_usuario/:id_producto", async (req, res) => {
  const { id_usuario, id_producto } = req.params;
  const { cantidad } = req.body;

  try {
    const carrito = await Carrito.findOne({ id_usuario: parseInt(id_usuario) });

    if (!carrito) {
      return res.status(404).json({ message: "Carrito no encontrado" });
    }

    const producto = carrito.productos.find(p => p.id_producto === parseInt(id_producto));

    if (!producto) {
      return res.status(404).json({ message: "Producto no encontrado in carrito" });
    }

    producto.cantidad = cantidad;
    await carrito.save();

    res.status(200).json(carrito);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/carrito/:id_usuario", async (req, res) => {
  const { id_usuario } = req.params;

  try {
    const carrito = await Carrito.findOneAndUpdate(
      { id_usuario: parseInt(id_usuario) },
      { $set: { productos: [], cupon_aplicado: null } },
      { new: true }
    );

    if (!carrito) {
      return res.status(404).json({ message: "Carrito no encontrado" });
    }

    res.status(200).json(carrito);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- CUPONES ---

const cuponSchema = new mongoose.Schema({
  id_cupon: Number,
  codigo: String,
  descuento: Number,
  fecha_expiracion: Date,
});
const Cupon = mongoose.model("Cupon", cuponSchema, "cupones");

const contadorCuponSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});
const ContadorCupon = mongoose.model("ContadorCupon", contadorCuponSchema, "contadorCupones");

app.get("/cupones", async (req, res) => {
  try {
    const cupones = await Cupon.find();
    res.status(200).json(cupones);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.post("/carrito/:id_usuario/aplicar-cupon", async (req, res) => {
  const { id_usuario } = req.params;
  const { codigo } = req.body;

  try {
    const cupon = await Cupon.findOne({ codigo });

    if (!cupon) {
      return res.status(404).json({ message: "Cupón no encontrado" });
    }

    const carritoActualizado = await Carrito.findOneAndUpdate(
      { id_usuario },
      { $set: { cupon_aplicado: cupon } },
      { new: true }
    );

    res.status(200).json({ carrito: carritoActualizado, cupon });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al aplicar el cupón" });
  }
});

app.post("/cupones", async (req, res) => {
  const { codigo, descuento, fecha_expiracion } = req.body;
  try {
    const contador = await ContadorCupon.findByIdAndUpdate(
      "id_cupon",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );
    const nuevoCupon = new Cupon({
      id_cupon: contador.sequence_value,
      codigo,
      descuento,
      fecha_expiracion,
    });
    await nuevoCupon.save();
    res.status(201).json({ message: "Cupón creado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.put("/cupones/:id", async (req, res) => {
  const { id } = req.params;
  const { codigo, descuento, fecha_expiracion } = req.body;
  try {
    const cuponActualizado = await Cupon.findByIdAndUpdate(
      id,
      { codigo, descuento, fecha_expiracion },
      { new: true }
    );
    res.status(200).json(cuponActualizado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

app.delete("/cupones/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await Cupon.findByIdAndDelete(id);
    res.status(200).json({ message: "Cupón eliminado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- AUTH EXTERNO (Microsoft, Google, OXXO) ---

app.post('/auth/microsoft/token', async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code || !redirectUri) {
    return res.status(400).json({ message: "code y redirectUri son requeridos" });
  }
  try {
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', process.env.MICROSOFT_CLIENT_ID);
    tokenParams.append('scope', 'User.Read');
    tokenParams.append('code', code);
    tokenParams.append('redirect_uri', redirectUri);
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('client_secret', process.env.MICROSOFT_CLIENT_SECRET);

    const tokenResponse = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      tokenParams,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get(
      'https://graph.microsoft.com/v1.0/me',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    res.json({ token: access_token, user: userResponse.data });
  } catch (error) {
    console.error("Error Microsoft OAuth:", error.response?.data || error.message);
    res.status(500).json({ message: "Error en el flujo OAuth de Microsoft" });
  }
});

app.post("/auth/google/token", async (req, res) => {
  const { code, redirectUri } = req.body;

  if (!code || !redirectUri) {
    return res.status(400).json({
      success: false,
      message: "code y redirectUri son requeridos",
    });
  }

  try {
    const params = new URLSearchParams();
    params.append("code", code);
    params.append("client_id", process.env.GOOGLE_CLIENT_ID);
    params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
    params.append("redirect_uri", redirectUri);
    params.append("grant_type", "authorization_code");

    const tokenResponse = await axios.post(
      "https://oauth2.googleapis.com/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const usuario = {
      nombre: userResponse.data.name,
      email: userResponse.data.email,
      proveedor: "google",
      picture: userResponse.data.picture,
    };

    const token = generarToken(usuario);

    res.json({
      success: true,
      token,
      usuario,
    });
  } catch (error) {
    console.error("Error en Google OAuth:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Error en el flujo OAuth de Google",
    });
  }
});

// ===============================
// API EMBEDDED TOKEN PRESET (adaptado y verificado)
// ===============================
const PRESET_DOMAIN = process.env.PRESET_DOMAIN || "https://025175db.us2a.app.preset.io";
const DASHBOARD_ID = process.env.PRESET_EMBED_ID || "eb982890-e494-42f1-8811-98580ce2be0b";
const PRIVATE_KEY = (() => {
  let key = process.env.PRESET_PRIVATE_KEY;
  if (!key) return "";
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  key = key.trim().replace(/^"+|"+$/g, "");
  return key;
})();

app.get("/api/v1/preset/embedded-token", async (req, res) => {
  try {
    // Duración del token: 5 minutos (300 segundos)
    const expiresInSeconds = 300;

    // Payload para el JWT embed
    const payload = {
      resources: [
        {
          type: "dashboard",
          id: DASHBOARD_ID,
        },
      ],
      rls: [],
      user: {
        username: "guest_user",
      },
    };

    const token = jwt.sign(payload, PRIVATE_KEY, {
      algorithm: "RS256",
      expiresIn: expiresInSeconds,
    });

    // URL de embed correcta (NO uses /manage)
    const embedUrl = `${PRESET_DOMAIN}/superset/dashboard/${DASHBOARD_ID}/?standalone=1`;

    res.json({
      token,
      url: embedUrl,
      expires_in: expiresInSeconds
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

export default app;
