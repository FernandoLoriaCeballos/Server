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

dotenv.config(); // Siempre al inicio

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://reviere-nube.vercel.app',
    '*' // Temporal
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

const generarToken = (usuario) => {
  return jwt.sign(usuario, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES || "1h",
  });
};

app.use("/auth", authRoutes);

// <-- REMOVED this early listener to avoid double listen (was: app.listen(3000,...)) -->

app.use(express.static('dist', {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// --- START: uploads + multer setup ---
const UPLOADS_BASE = path.join(process.cwd(), 'uploads');
const COMPANY_UPLOADS = path.join(UPLOADS_BASE, 'companies');
const PRODUCT_UPLOADS = path.join(UPLOADS_BASE, 'products');
fs.mkdirSync(COMPANY_UPLOADS, { recursive: true });
fs.mkdirSync(PRODUCT_UPLOADS, { recursive: true });
// servir archivos subidos
app.use('/uploads', express.static(UPLOADS_BASE));
const makeFilename = (originalName) => {
  const timestamp = Date.now();
  const safeName = originalName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\.-]/g, '');
  return `${timestamp}_${safeName}`;
};
const companyStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, COMPANY_UPLOADS),
  filename: (req, file, cb) => cb(null, makeFilename(file.originalname))
});
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRODUCT_UPLOADS),
  filename: (req, file, cb) => cb(null, makeFilename(file.originalname))
});
const uploadCompany = multer({ storage: companyStorage });
const uploadProduct = multer({ storage: productStorage });
// --- END: uploads + multer setup ---

// Simplified multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Create uploads folder if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Conexión a la base de datos MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("Conectado exitosamente a MongoDB Atlas");
  })
  .catch((error) => {
    console.error("Error de conexión a MongoDB Atlas:", error);
  });

// Define el esquema del modelo para Usuarios
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
  id_empresa: Number, // <-- nuevo campo
  fecha_reg: {
    type: Date,
    default: Date.now
  }
});

// Esquema y modelo de Empresa
const empresaSchema = new mongoose.Schema({
  id_empresa: Number,
  nombre_empresa: String,  // nombre cambiado a nombre_empresa si así lo usas en el frontend
  email: String,
  password: String,
  descripcion: String,
  telefono: String,
  logo: String,
  fecha_creacion: { type: Date, default: Date.now }
});
const Empresa = mongoose.model("Empresa", empresaSchema, "empresas");

// Esquema y modelo del contador para empresas
const contadorEmpresaSchema = new mongoose.Schema({
  _id: { type: String, default: "id_empresa" }, // O puedes dejarlo dinámico
  sequence_value: { type: Number, default: 0 }
});

const ContadorEmpresa = mongoose.model("ContadorEmpresa", contadorEmpresaSchema, "contadorEmpresa");

// Esquema y modelo de Empleado
const empleadoSchema = new mongoose.Schema({
  id_empleado: Number,
  nombre: String,
  email: String,
  password: String,
  id_empresa: Number, // Relación con Empresa
  fecha_reg: { type: Date, default: Date.now }
});
const Empleado = mongoose.model("Empleado", empleadoSchema, "empleados");

// Define el esquema del modelo para Productos (ACTUALIZADO)
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
    required: true // Hacemos que sea obligatorio
  },
  fecha_reg: { type: Date, default: Date.now },
});

// Define el modelo para Productos
const Producto = mongoose.model("Producto", productoSchema, "productos");

// Define el esquema del modelo para el contador de productos
const contadorProductoSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

// Define el modelo para el contador de productos
const ContadorProducto = mongoose.model("ContadorProducto", contadorProductoSchema, "contadorProductos");

// Define el esquema del modelo para Ofertas (NUEVO)
const ofertaSchema = new mongoose.Schema({
  id_oferta: Number,
  id_producto: Number,
  descuento: Number,
  precio_oferta: Number,
  fecha_inicio: Date,
  fecha_fin: Date,
  estado: { type: Boolean, default: true }
});

// Define el modelo para Ofertas
const Oferta = mongoose.model("Oferta", ofertaSchema, "ofertas");

// Define el esquema del modelo para el contador de ofertas
const contadorOfertaSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

// Define el modelo para el contador de ofertas
const ContadorOferta = mongoose.model("ContadorOferta", contadorOfertaSchema, "contadorOfertas");

// Rutas de Productos

// Ruta POST para agregar un nuevo producto
app.post("/productos", upload.single('foto'), async (req, res) => {
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
      foto, // Guardamos solo el nombre del archivo
      id_empresa: parseInt(id_empresa)
    });

    await nuevoProducto.save();
    res.status(201).json({ 
      message: "Producto agregado exitosamente",
      foto: foto ? `/uploads/${foto}` : null // Devolvemos la URL completa
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta GET para obtener todos los productos
app.get("/productos", async (req, res) => {
  try {
    const { id_empresa } = req.query; // Obtener id_empresa de los query params
    let query = {};
    
    // Si se proporciona id_empresa, filtrar por empresa
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

// Ruta PUT para actualizar un producto
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

// Ruta DELETE para eliminar un producto
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

// Rutas de Ofertas (NUEVO)

// Ruta POST para crear una nueva oferta
app.post("/ofertas", async (req, res) => {
  const { id_producto, descuento, precio_oferta, fecha_inicio, fecha_fin, estado } = req.body;
  try {
    // Primero verificar si el producto existe
    const producto = await Producto.findOne({ id_producto });
    if (!producto) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    // Crear el contador para la oferta
    const contador = await ContadorOferta.findByIdAndUpdate(
      "id_oferta",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    // Crear la nueva oferta
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

    // Actualizar el estado de oferta del producto
    await Producto.findOneAndUpdate(
      { id_producto },
      {
        en_oferta: true
      }
    );

    res.status(201).json({ message: "Oferta creada exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta GET para obtener todas las ofertas
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

// Ruta PUT para actualizar una oferta
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

    // Actualizar el estado de oferta del producto
    await Producto.findOneAndUpdate(
      { id_producto },
      {
        en_oferta: estado
      }
    );

    res.status(200).json(ofertaActualizada);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta DELETE para eliminar una oferta
app.delete("/ofertas/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const oferta = await Oferta.findById(id);
    if (oferta) {
      // Restaurar el precio original del producto
      await Producto.findOneAndUpdate(
        { id_producto: oferta.id_producto },
        {
          precio: oferta.precio_original, // Cambio aquí
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

// Función para verificar ofertas vencidas
const verificarOfertasVencidas = async () => {
  try {
    const ofertasVencidas = await Oferta.find({
      fecha_fin: { $lt: new Date() },
      estado: true
    });

    for (const oferta of ofertasVencidas) {
      // Desactivar la oferta
      await Oferta.findByIdAndUpdate(
        oferta._id,
        { estado: false }
      );

      // Restaurar el precio original del producto
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

// Ejecutar la verificación de ofertas vencidas cada hora
setInterval(verificarOfertasVencidas, 3600000); // 3600000 ms = 1 hora

// Define el modelo para Usuarios
const Usuario = mongoose.model("Usuario", usuarioSchema, "usuarios");

// Define el esquema del modelo para el contador de usuarios
const contadorSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

// Define el modelo para el contador de usuarios
const Contador = mongoose.model("Contador", contadorSchema, "contadores");

// Ruta POST para agregar un nuevo usuario
app.post("/registro", async (req, res) => {
  const { nombre, email, password } = req.body;
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
      rol: "usuario", // 👈 SE AÑADE AUTOMÁTICAMENTE
    });

    await nuevoUsuario.save();
    res.status(201).json({ message: "Usuario registrado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta POST exclusiva del SuperAdmin para registrar usuarios con cualquier rol
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
      // Agregar solo si aplica
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
  const empresaId = req.headers["empresa_id"]; // 👈 Asegúrate de enviarlo desde el frontend

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

// Ruta POST exclusiva del Admin de Empresa para registrar empleados
app.post("/registro/empleados-empresa", async (req, res) => {
  const rolSolicitante = req.headers["rol"];
  const empresaId = req.headers["empresa_id"];

  if (rolSolicitante !== "admin_empresa") {
    return res.status(403).json({ message: "Acceso denegado. Solo administradores de empresa pueden registrar empleados." });
  }

  const { nombre, email, password } = req.body;

  if (!nombre || !email || !password || !empresaId) {
    return res.status(400).json({ message: "Faltan datos obligatorios" });
  }

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
    res.status(500).json({ message: "Error interno del servidor" });
  }
});


app.post("/registro/empresa", upload.single('logo'), async (req, res) => {
  try {
    const { nombre_empresa, email, password, descripcion, telefono } = req.body;
    const logo = req.file ? req.file.filename : null; // Solo guardamos el nombre del archivo

    if (!nombre_empresa || !email || !password) {
      return res.status(400).json({ message: "Faltan campos obligatorios" });
    }

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
      logo // Guardamos solo el nombre del archivo
    });

    await nuevaEmpresa.save();
    res.status(201).json({ 
      message: "Empresa registrada exitosamente", 
      id_empresa: nuevaEmpresa.id_empresa,
      logo: logo ? `/uploads/${logo}` : null // Devolvemos la URL completa
    });
  } catch (error) {
    console.error("Error al registrar empresa:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// OPTIONAL: accept file when creating via /empresas as well
app.post("/empresas", uploadCompany.single('logo'), async (req, res) => {
  try {
    const { nombre_empresa, email, password, descripcion, telefono } = req.body;

    const contador = await ContadorEmpresa.findByIdAndUpdate(
      "id_empresa",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    const logoPath = req.file ? `/uploads/companies/${req.file.filename}` : null;

    const nuevaEmpresa = new Empresa({
      id_empresa: contador.sequence_value,
      nombre_empresa,
      email,
      password,
      descripcion,
      telefono,
      logo: logoPath,
      fecha_creacion: new Date()
    });

    await nuevaEmpresa.save();
    res.status(201).json({ message: "Empresa creada exitosamente", empresa: nuevaEmpresa });
  } catch (error) {
    console.error("Error al crear empresa:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta de inicio de sesión Usuarios (Login)
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

    // 👉 Agregar empresa_id si aplica
    if (usuario.rol === "admin_empresa" || usuario.rol === "empleado") {
      response.empresa_id = usuario.id_empresa;  // Usa el campo correcto
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta de inicio de sesión para Empresa
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

// Ruta de inicio de sesión para Empleado
app.post("/login/empleado", async (req, res) => {
  try {
    const { email, password, id_empresa } = req.body;

    const empleado = await Empleado.findOne({ email });

    if (!empleado || empleado.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    // ✅ Corregido: comparar contra id_empresa correctamente
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


// Nueva ruta para obtener todos los usuarios
app.get("/usuarios", async (req, res) => {
  try {
    const usuarios = await Usuario.find();
    res.status(200).json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Obtener todas las empresas
app.get("/empresas", async (req, res) => {
  try {
    const empresas = await Empresa.find();
    res.status(200).json(empresas);
  } catch (error) {
    console.error("Error al obtener empresas:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Agregar empresa (actualizada para usar contador autoincremental)
app.post("/empresas", async (req, res) => {
  try {
    const { nombre_empresa, email, password, descripcion, telefono, logo } = req.body;

    // Obtener el siguiente ID autoincremental usando el contador
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

// Actualizar empresa (sin modificar id_empresa)
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

// Eliminar empresa
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

//Nueva ruta para obtener los empleados de una empresa
app.get("/empleados/empresa/:empresa_id", async (req, res) => {
  const { empresa_id } = req.params;

  try {
    const empresaIdNum = parseInt(empresa_id);

    // Empleados desde la colección empleados
    const empleadosDirectos = await Empleado.find({ id_empresa: empresaIdNum });

    // Usuarios con rol 'empleado' o 'admin_empresa' y empresa asignada
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

// Ruta para obtener todos los usuarios y empleados con nombre de empresa
app.get("/todos-usuarios-empleados", async (req, res) => {
  try {
    const [usuarios, empleados, empresas] = await Promise.all([
      Usuario.find(),
      Empleado.find(),
      Empresa.find()
    ]);

    // Mapa de empresas por ID
    const empresaMap = {};
    empresas.forEach(e => {
      empresaMap[e.id_empresa] = e.nombre_empresa;
    });

    // Unificamos formato de datos
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


// Nueva ruta para actualizar un usuario (incluye rol y empresa correctamente)
app.put("/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, email, password, rol, empresa_id } = req.body;

  try {
    // Preparamos los campos a actualizar
    const updateFields = {
      nombre,
      email,
      password,
      rol,
    };

    // Si el rol es empleado o admin_empresa, asignamos id_empresa
    if (rol === "empleado" || rol === "admin_empresa") {
      updateFields.id_empresa = empresa_id ? parseInt(empresa_id) : null;
    } else {
      // Si no, eliminamos la asignación de empresa
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


// Nueva ruta para eliminar un usuario
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

// Define el esquema del modelo para Reseñas
const resenaSchema = new mongoose.Schema({
  id_resena: Number,
  id_producto: Number,
  id_usuario: Number,
  calificacion: Number,
  comentario: String,
  fecha: { type: Date, default: Date.now },
});

// Define el modelo para Reseñas
const Resena = mongoose.model("Resena", resenaSchema, "resenas");

// Define el esquema del modelo para el contador de reseñas
const contadorResenaSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

// Define el modelo para el contador de reseñas
const ContadorResena = mongoose.model("ContadorResena", contadorResenaSchema, "contadorResenas");

// Ruta POST para agregar una nueva reseña
app.post("/resenas", async (req, res) => {
  const { id_producto, id_usuario, calificacion, comentario, fecha } = req.body;

  // Validar si se debe insertar la reseña
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

// Ruta GET para obtener todas las reseñas
app.get("/resenas", async (req, res) => {
  try {
    const resenas = await Resena.find();
    res.status(200).json(resenas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta PUT para actualizar una reseña
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

// Ruta DELETE para eliminar una reseña
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

// Define el esquema del modelo para Recibos
const reciboSchema = new mongoose.Schema({
  id_recibo: Number,
  id_compra: Number,
  id_usuario: Number,
  fecha_emi: { type: Date, default: Date.now },
  detalle: String,
  precio_total: Number,
});

// Define el modelo para Recibos
const Recibo = mongoose.model("Recibo", reciboSchema, "recibos");

// Define el esquema del modelo para el contador de recibos
const contadorReciboSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

// Define el modelo para el contador de recibos
const ContadorRecibo = mongoose.model("ContadorRecibo", contadorReciboSchema, "contadorRecibos");

//RUTA GET OBTENER TODOS LOS RECIBOS
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

//RUTA GET DE OBTENER un recibo por ID
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

// Ruta POST para crear un nuevo recibo
app.post("/recibos", async (req, res) => {
  const { id_usuario, productos, cupon_aplicado, total } = req.body;

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

    // Vaciar el carrito después de la compra
    await Carrito.findOneAndUpdate(
      { id_usuario },
      { $set: { productos: [], cupon_aplicado: null } }
    );

    res.status(201).json({ message: "Recibo agregado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

//RUTA ELIMINAR RECIBO
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

// Esquema del catálogo
const catalogoSchema = new mongoose.Schema({
  id_catalogo: Number,
  nombre: String,
  descripcion: String,
  fecha_act: { type: Date, default: Date.now },
  productos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Producto' }],
});

// Middleware para actualizar la fecha antes de guardar
catalogoSchema.pre('save', function (next) {
  this.fecha_act = Date.now();
  next();
});

// Middleware para actualizar la fecha antes de actualizar
catalogoSchema.pre('findOneAndUpdate', function (next) {
  this._update.fecha_act = Date.now();
  next();
});

const Catalogo = mongoose.model('Catalogo', catalogoSchema, 'catalogo');

// Esquema del contador de catálogo
const contadorCatalogoSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

const ContadorCatalogo = mongoose.model('ContadorCatalogo', contadorCatalogoSchema, 'contadores_catalogo');

// Ruta para crear un nuevo catálogo
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

// Ruta para obtener todos los catálogos
app.get('/catalogo', async (req, res) => {
  try {
    const catalogos = await Catalogo.find().populate('productos', 'nombre');
    res.status(200).json(catalogos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// Ruta para actualizar un catálogo
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

// Ruta para eliminar un catálogo
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

// Define el esquema del modelo para Carritos
const carritoSchema = new mongoose.Schema({
  id_usuario: Number,
  productos: [
    {
      id_producto: Number,
      cantidad: Number,
      nombre: String,
      precio: Number,
      foto: String,
      esPromocion: Boolean  // Añadido el campo esPromocion
    },
  ],
  cupon_aplicado: {
    codigo: String,
    descuento: Number
  }
});

// Define el modelo para Carritos
const Carrito = mongoose.model("Carrito", carritoSchema, "carritos");

// Ruta GET para obtener el carrito de un usuario
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

// Ruta PUT para actualizar todo el carrito
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

// Ruta POST para agregar un producto al carrito
app.post("/carrito/:id_usuario", async (req, res) => {
  const { id_usuario } = req.params;
  const { id_producto, cantidad, nombre, precio, foto, esPromocion } = req.body;

  try {
    const carrito = await Carrito.findOne({ id_usuario: parseInt(id_usuario) });

    if (!carrito) {
      // Si el carrito no existe, créalo con el primer producto
      const nuevoCarrito = new Carrito({
        id_usuario: parseInt(id_usuario),
        productos: [{
          id_producto,
          cantidad,
          nombre,
          precio,
          foto,
          esPromocion // Agregar la propiedad esPromocion
        }],
        cupon_aplicado: null
      });
      await nuevoCarrito.save();
      return res.status(201).json(nuevoCarrito);
    }

    // Buscar si el producto ya existe en el carrito
    const productoExistente = carrito.productos.find(p => p.id_producto === id_producto);

    if (productoExistente) {
      // Actualizar la cantidad si el producto ya existe
      productoExistente.cantidad += cantidad;
    } else {
      // Agregar el nuevo producto si no existe
      carrito.productos.push({
        id_producto,
        cantidad,
        nombre,
        precio,
        foto,
        esPromocion // Agregar la propiedad esPromocion
      });
    }

    await carrito.save();
    res.status(200).json(carrito);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta DELETE para eliminar un producto del carrito
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

// Ruta PUT para actualizar la cantidad de un producto específico
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

// Ruta para vaciar el carrito
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

//CUPONES

// Define el esquema del modelo para Cupones
const cuponSchema = new mongoose.Schema({
  id_cupon: Number,
  codigo: String,
  descuento: Number,
  fecha_expiracion: Date,
});

// Define el modelo para Cupones
const Cupon = mongoose.model("Cupon", cuponSchema, "cupones");

// Define el esquema del modelo para el contador de cupones
const contadorCuponSchema = new mongoose.Schema({
  _id: String,
  sequence_value: { type: Number, default: 0 }
});

// Define el modelo para el contador de cupones
const ContadorCupon = mongoose.model("ContadorCupon", contadorCuponSchema, "contadorCupones");

// Obtener todos los cupones
app.get("/cupones", async (req, res) => {
  try {
    const cupones = await Cupon.find();
    res.status(200).json(cupones);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta POST para aplicar un cupón
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

// Crear un nuevo cupón
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

// Actualizar un cupón existente
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

// Eliminar un cupón
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

// Ruta para intercambio de code por access_token y datos de usuario con Microsoft
app.post('/auth/microsoft/token', async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code || !redirectUri) {
    return res.status(400).json({ message: "code y redirectUri son requeridos" });
  }
  try {
    // 1. Intercambiar code por access_token
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

    // 2. Obtener datos del usuario
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
    // 1️⃣ Intercambiar code por access_token
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

    // 2️⃣ Obtener los datos del usuario desde Google
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

    // 3️⃣ Generar tu JWT
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

app.post("/oxxo-pay", async (req, res) => {
  const { total, email } = req.body;

  if (!total || !email) {
    return res.status(400).json({
      message: "Los campos 'total' y 'email' son requeridos.",
    });
  }

  try {
    // 1️⃣ Configuración de credenciales y URL de Conekta
    const privateKey = process.env.CONEKTA_PRIVATE_KEY;
    const api_url = "https://api.conekta.io/orders";

    // 2️⃣ Crear la orden de pago
    const orderData = {
      currency: "MXN",
      customer_info: { email },
      charges: [
        {
          amount: Math.round(parseFloat(total) * 100),
          payment_method: {
            type: "oxxo_cash",
          },
        },
      ],
    };

    const response = await axios.post(api_url, orderData, {
      headers: {
        Authorization: `Bearer ${privateKey}`,
        "Content-Type": "application/json",
        "Conekta-Version": "2.1.0",
      },
    });

    // 3️⃣ Extraer datos del pago
    const oxxoCharge = response.data.charges.data[0];
    const oxxoReference = oxxoCharge.payment_method.reference;
    const expirationDate = new Date(
      oxxoCharge.payment_method.expires_at * 1000
    ).toLocaleString();

    res.json({
      success: true,
      reference: oxxoReference,
      expirationDate,
    });
  } catch (error) {
    console.error("Error al generar pago OXXO:", error.response?.data || error.message);
    res.status(500).json({
      message: "Error al procesar el pago OXXO.",
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

// Inicia el servidor
export default app;