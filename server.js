import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from 'dotenv';

dotenv.config();

// Configura la aplicación Express
const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://reviere-nube.vercel.app', // Tu URL de Vercel
    '*' // Temporalmente para pruebas
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.static('dist', { setHeaders: (res, path) => {
  if (path.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript');
  }
}}));

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
  fecha_reg: { type: Date, default: Date.now },
});

// Esquema y modelo de Empresa
const empresaSchema = new mongoose.Schema({
  id_empresa: Number,
  nombre: String,
  email: String,
  password: String,
  fecha_reg: { type: Date, default: Date.now }
});
const Empresa = mongoose.model("Empresa", empresaSchema, "empresas");

// Esquema y modelo de Empleado
const empleadoSchema = new mongoose.Schema({
  id_empleado: Number,
  nombre: String,
  email: String,
  password: String,
  empresa_id: Number, // Relación con Empresa
  fecha_reg: { type: Date, default: Date.now }
});
const Empleado = mongoose.model("Empleado", empleadoSchema, "empleados");

// Define el esquema del modelo para Productos (ACTUALIZADO)
const productoSchema = new mongoose.Schema({
  id_producto: Number, 
  nombre: String,
  descripcion: String,
  precio: Number,
  precio_original: Number, // Nuevo campo para guardar el precio original
  en_oferta: { type: Boolean, default: false }, // Nuevo campo para indicar si está en oferta
  stock: Number,
  categoria: String,
  foto: String,
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
app.post("/productos", async (req, res) => {
  const { nombre, descripcion, precio, stock, categoria, foto } = req.body;
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
      foto 
    });
    await nuevoProducto.save();
    res.status(201).json({ message: "Producto agregado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta GET para obtener todos los productos
app.get("/productos", async (req, res) => {
  try {
    const productos = await Producto.find();
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
    // Obtiene el valor actual del contador y lo incrementa en uno
    const contador = await Contador.findByIdAndUpdate(
      "id_usuario",
      { $inc: { sequence_value: 1 } },
      { new: true, upsert: true }
    );

    // Registro de empresa con logo por enlace
app.post("/registro/empresa", async (req, res) => {
  try {
    const { nombre_empresa, email, password, descripcion, telefono, logo_url } = req.body;

    if (!nombre_empresa || !email || !password || !logo_url) {
      return res.status(400).json({ message: "Faltan campos obligatorios" });
    }

    const contadorEmpresa = await db.collection("contador_empresa").findOneAndUpdate(
      {},
      { $inc: { secuencia: 1 } },
      { returnDocument: "after", upsert: true }
    );

    const nuevaEmpresa = {
      id_empresa: contadorEmpresa.value.secuencia,
      nombre_empresa,
      email,
      password,
      descripcion,
      telefono,
      logo: logo_url,
      fecha_creacion: new Date()
    };

    await db.collection("empresas").insertOne(nuevaEmpresa);
    res.status(201).json({ message: "Empresa registrada exitosamente", id_empresa: nuevaEmpresa.id_empresa });
  } catch (error) {
    console.error("Error al registrar empresa:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

    // Crea un nuevo usuario con el valor del contador como id_usuario
    const nuevoUsuario = new Usuario({ id_usuario: contador.sequence_value, nombre, email, password });
    await nuevoUsuario.save();
    res.status(201).json({ message: "Usuario registrado exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta de inicio de sesión Usuarios (Login)
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await Usuario.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    res.status(200).json({ 
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      message: `¡Bienvenido ${user.nombre}!`
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta de inicio de sesión para Empresa
app.post("/login/empresa", async (req, res) => {
  try {
    const { email, password } = req.body;
    const empresa = await Empresa.findOne({ email });

    if (!empresa || empresa.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    res.status(200).json({
      id_empresa: empresa.id_empresa,
      nombre: empresa.nombre,
      message: `¡Bienvenido ${empresa.nombre}!`
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta de inicio de sesión para Empleado
app.post("/login/empleado", async (req, res) => {
  try {
    const { email, password } = req.body;
    const empleado = await Empleado.findOne({ email });

    if (!empleado || empleado.password !== password) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const empresa = await Empresa.findOne({ id_empresa: empleado.empresa_id });

    if (!empresa) {
      return res.status(403).json({ message: "Este empleado no está asociado a ninguna empresa válida." });
    }

    res.status(200).json({
      id_empleado: empleado.id_empleado,
      nombre: empleado.nombre,
      id_empresa: empresa.id_empresa,
      message: `¡Bienvenido ${empleado.nombre} de ${empresa.nombre}!`
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

// Nueva ruta para actualizar un usuario
app.put("/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, email, password } = req.body;
  try {
    const usuarioActualizado = await Usuario.findByIdAndUpdate(
      id,
      { nombre, email, password },
      { new: true }
    );
    res.status(200).json(usuarioActualizado);
  } catch (error) {
    console.error(error);
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
catalogoSchema.pre('save', function(next) {
  this.fecha_act = Date.now();
  next();
});

// Middleware para actualizar la fecha antes de actualizar
catalogoSchema.pre('findOneAndUpdate', function(next) {
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
      return res.status(404).json({ message: "Producto no encontrado en el carrito" });
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

// Inicia el servidor
export default app;