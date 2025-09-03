const express = require('express');
const cors = require('cors');
const app = express();
const auth = require('./middleware/auth');
const palotRoutes = require('./routes/palots');
const parcelasPalotsRoutes = require('./routes/parcelasPalots');
app.use(cors());
app.use(express.json());
// Attach authentication middleware
app.use(auth);
// Register application routes
app.use(palotRoutes);
app.use(parcelasPalotsRoutes);
app.get('/', (req, res) => {
  res.json({message: 'API operativa'});
});
module.exports = app;
