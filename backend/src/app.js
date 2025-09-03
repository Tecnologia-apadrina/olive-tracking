const express = require('express');
const cors = require('cors');
const app = express();
const auth = require('./middleware/auth');
const palotRoutes = require('./routes/palots');
const parcelasPalotsRoutes = require('./routes/parcelasPalots');
const olivoRoutes = require('./routes/olivos');
const parcelasRoutes = require('./routes/parcelas');
app.use(cors());
app.use(express.json());
// Attach authentication middleware
app.use(auth);
// Register application routes
app.use(palotRoutes);
app.use(parcelasPalotsRoutes);
app.use(olivoRoutes);
app.use(parcelasRoutes);
app.get('/', (req, res) => {
  res.json({message: 'API operativa'});
});
module.exports = app;
