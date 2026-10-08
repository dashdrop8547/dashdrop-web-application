// index.js - Main entry point for the semester project backend

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/semester';
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Models
const User = require('./models/user');
const Item = require('./models/item');

// ---------- Authentication ---------- //
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.id);
    next();
  } catch (err) {
    return res.sendStatus(403);
  }
};

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Missing fields' });
  const existing = await User.findOne({ username });
  if (existing) return res.status(409).json({ message: 'User exists' });
  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashed });
  await user.save();
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  res.json({ token });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
  res.json({ token });
});

// ---------- CRUD for Item ---------- //
app.post('/api/items', authMiddleware, async (req, res) => {
  const item = new Item({ ...req.body, owner: req.user._id });
  await item.save();
  io.emit('itemCreated', item); // real‑time notification
  res.status(201).json(item);
});

app.get('/api/items', authMiddleware, async (req, res) => {
  const items = await Item.find({ owner: req.user._id });
  res.json(items);
});

app.get('/api/items/:id', authMiddleware, async (req, res) => {
  const item = await Item.findOne({ _id: req.params.id, owner: req.user._id });
  if (!item) return res.sendStatus(404);
  res.json(item);
});

app.put('/api/items/:id', authMiddleware, async (req, res) => {
  const item = await Item.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id },
    req.body,
    { new: true }
  );
  if (!item) return res.sendStatus(404);
  io.emit('itemUpdated', item);
  res.json(item);
});

app.delete('/api/items/:id', authMiddleware, async (req, res) => {
  const result = await Item.deleteOne({ _id: req.params.id, owner: req.user._id });
  if (result.deletedCount === 0) return res.sendStatus(404);
  io.emit('itemDeleted', { id: req.params.id });
  res.sendStatus(204);
});

// ---------- File Upload ---------- //
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage });

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// ---------- Analytics ---------- //
app.get('/api/analytics', authMiddleware, async (req, res) => {
  const totalItems = await Item.countDocuments({ owner: req.user._id });
  const recentItems = await Item.find({ owner: req.user._id })
    .sort({ createdAt: -1 })
    .limit(5);
  res.json({ totalItems, recentItems });
});

// ---------- WebSocket ---------- //
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
