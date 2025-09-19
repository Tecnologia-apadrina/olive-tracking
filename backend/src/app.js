const express = require('express');
const cors = require('cors');
const app = express();
const auth = require('./middleware/auth');
const palotRoutes = require('./routes/palots');
const parcelasPalotsRoutes = require('./routes/parcelasPalots');
const olivoRoutes = require('./routes/olivos');
const parcelasRoutes = require('./routes/parcelas');
const usersRoutes = require('./routes/users');
const importRoutes = require('./routes/import');
const versionRoutes = require('./routes/version');
const syncRoutes = require('./routes/sync');
app.use(cors());
// Increase payload limit to allow large CSV uploads wrapped in JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Attach authentication middleware
app.use(auth);
// Register application routes
app.use(palotRoutes);
app.use(parcelasPalotsRoutes);
app.use(olivoRoutes);
app.use(parcelasRoutes);
app.use(usersRoutes);
app.use(importRoutes);
app.use(versionRoutes);
app.use(syncRoutes);
app.get('/', (req, res) => {
  res.json({message: 'API operativa'});
});
module.exports = app;
